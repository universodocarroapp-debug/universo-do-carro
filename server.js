require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase
const supabaseUrl = 'https://xkiqkzrmavnqchqkyyvw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseKey) {
    console.error('\n❌  ERRO FATAL: SUPABASE_SERVICE_KEY não definida no .env!');
    console.error('   Adicione a service_role key do painel Supabase > Settings > API.\n');
    process.exit(1);
}

// Criando cliente isolado (sem persistir sessão para evitar que o login de um bloqueie o cadastro do outro)
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

// Validação de tipo real de imagem por magic bytes (não confia no MIME declarado pelo cliente)
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const IMAGE_SIGNATURES = [
    { mime: 'image/jpeg', ext: 'jpg',  bytes: [0xFF, 0xD8, 0xFF] },
    { mime: 'image/png',  ext: 'png',  bytes: [0x89, 0x50, 0x4E, 0x47] },
    { mime: 'image/gif',  ext: 'gif',  bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: 'image/webp', ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46],
      extra: (b) => b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

function detectImageMime(buffer) {
    for (const sig of IMAGE_SIGNATURES) {
        if (sig.bytes.every((b, i) => buffer[i] === b)) {
            if (!sig.extra || sig.extra(buffer)) return { mime: sig.mime, ext: sig.ext };
        }
    }
    return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE } });
const app = express();
const port = 3000;

app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error('Origem não permitida pelo CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(bodyParser.json());
app.use(express.static(__dirname));

// Middlewares de autenticação — validam o JWT emitido pelo Supabase
async function requireAuth(req, res, next) {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    const { data: { user }, error } = await supabase.auth.getUser(header.slice(7));
    if (error || !user) return res.status(401).json({ error: 'Token inválido ou expirado.' });
    req.user = user;
    next();
}

async function requireAdmin(req, res, next) {
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Autenticação necessária.' });
    }
    const { data: { user }, error } = await supabase.auth.getUser(header.slice(7));
    if (error || !user) return res.status(401).json({ error: 'Token inválido ou expirado.' });
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito a administradores.' });
    req.user = user;
    next();
}

app.post('/api/register', async (req, res) => {
    const { name, email, password, role, cnpj, tipo_empresa, cidade, telefone } = req.body;
    if (!email || !password || !role || !telefone) return res.status(400).json({ error: 'Faltam dados obrigatórios. Telefone é necessário.' });
    if (role === 'empresa' && tipo_empresa === 'autopecas' && !cidade) return res.status(400).json({ error: 'Cidade é obrigatória para Autopeças no cadastro.' });

    if (role === 'empresa' && cnpj) {
        const cleanCnpj = cnpj.replace(/\D/g, '');
        if (cleanCnpj.length !== 14) return res.status(400).json({ error: 'CNPJ com tamanho inválido.' });
        try {
            const bData = await new Promise((resolve, reject) => {
                const https = require('https');
                https.get(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, (response) => {
                    if (response.statusCode >= 400) return reject(new Error('Falha HTTP'));
                    let rawData = '';
                    response.on('data', (chunk) => rawData += chunk);
                    response.on('end', () => resolve(JSON.parse(rawData)));
                }).on('error', reject);
            });
            if (bData.descricao_situacao_cadastral && bData.descricao_situacao_cadastral !== 'ATIVA') {
                return res.status(400).json({ error: 'Este CNPJ não encontra-se ATIVO na base da Receita Federal.' });
            }
        } catch (e) {
            console.error(">>> ERRO NA VALIDAÇÃO DO CNPJ <<<", e.message || e);
            return res.status(400).json({ error: 'A validação da Receita falhou. Verifique o CNPJ.' });
        }
    }

    try {
        // Excluir possível usuário travado pela metade antes de tentar recriar
        const { data: searchUser } = await supabase.auth.admin.listUsers();
        const stuckUser = searchUser?.users?.find(u => u.email === email);
        if (stuckUser) await supabase.auth.admin.deleteUser(stuckUser.id);

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email,
            password,
            email_confirm: true 
        });

        if (authError) return res.status(500).json({ error: authError.message });

        const userId = authData.user.id;

        const { error: profileError } = await supabase.from('profiles').insert([
            { id: userId, name: name || 'Usuário', role, cnpj: cnpj || null, tipo_empresa: tipo_empresa || null, cidade: cidade || null, telefone }
        ]);

        if (profileError) {
            console.error(">>> ERRO FATAL AO SALVAR PERFIL <<<", profileError);
            await supabase.auth.admin.deleteUser(userId); // Rollback
            return res.status(500).json({ error: `Erro no Banco: ${profileError.message || JSON.stringify(profileError)}` });
        }

        res.status(201).json({ success: true, user: { id: userId, role } });
    } catch (e) {
        console.error('>>> ERRO INTERNO NO CADASTRO <<<', e);
        res.status(500).json({ error: 'Erro interno no servidor.', details: e.message || String(e) });
    }
});

app.post('/api/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Email ou senha inválidos.' });

    const { data: profile, error: profError } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();

    if (profError || !profile) return res.status(500).json({ error: 'Erro ao carregar seu perfil na nuvem.' });

    res.json({ success: true, user: profile, role: profile.role, access_token: authData.session?.access_token });
});

app.get('/api/users', requireAdmin, async (req, res) => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Erro' });
    res.json({ users: data });
});

app.post('/api/cotacoes', upload.single('foto'), async (req, res) => {
    const { user_id, marca, modelo, ano, chassi, peca, descricao, cidade } = req.body;
    if (!user_id || !peca || !cidade) return res.status(400).json({ error: 'Faltam dados. A cidade e a peça são obrigatórias.' });

    let foto_url = null;
    if (req.file) {
        const detected = detectImageMime(req.file.buffer);
        if (!detected) {
            return res.status(400).json({ error: 'Tipo de arquivo não permitido. Envie JPEG, PNG, GIF ou WEBP.' });
        }
        // Filename gerado internamente — ignora originalname do cliente
        const fileName = `${Date.now()}_${user_id}.${detected.ext}`;
        const { error: uploadError } = await supabase.storage.from('uploads').upload(fileName, req.file.buffer, { contentType: detected.mime });
        if (!uploadError) {
            const { data: pubData } = supabase.storage.from('uploads').getPublicUrl(fileName);
            foto_url = pubData.publicUrl;
        }
    }

    const { data, error } = await supabase.from('cotacoes').insert([
        { user_id, marca, modelo, ano, chassi, peca, descricao, foto_url, cidade }
    ]).select();

    if (error) return res.status(500).json({ error: 'Erro ao salvar cotação.' });
    res.json({ success: true, cotacao_id: data[0].id });
});

app.get('/api/cotacoes/todas', async (req, res) => {
    const { data, error } = await supabase.from('cotacoes').select(`*, profiles:user_id (cidade, name)`).neq('status', 'Concluído').order('id', { ascending: false });
    if (error) return res.status(500).json({ error: 'Erro' });
    
    const mapped = data.map(c => ({
        ...c,
        cidade: c.profiles?.cidade,
        cliente_nome: c.profiles?.name
    }));
    res.json({ cotacoes: mapped });
});

app.get('/api/cotacoes/minhas/:userId', async (req, res) => {
    const { data, error } = await supabase.from('cotacoes').select('*').eq('user_id', req.params.userId).order('id', { ascending: false });
    if (error) return res.status(500).json({ error: 'Erro' });
    res.json({ cotacoes: data });
});

app.post('/api/ofertas', requireAuth, async (req, res) => {
    const { cotacao_id, loja_id, valor, mensagem, garantia, peca_tipo } = req.body;
    if (loja_id !== req.user.id) {
        return res.status(403).json({ error: 'Não é permitido enviar ofertas em nome de outro usuário.' });
    }
    const { data, error } = await supabase.from('ofertas').insert([{ cotacao_id, loja_id, valor, mensagem, garantia, peca_tipo }]).select();
    if (error) return res.status(500).json({ error: 'Erro' });
    res.json({ success: true, oferta_id: data[0].id });
});

app.get('/api/ofertas/:cotacao_id', async (req, res) => {
    const { data, error } = await supabase.from('ofertas').select(`*, profiles:loja_id (name, telefone, cidade)`).eq('cotacao_id', req.params.cotacao_id).order('valor', { ascending: true });
    if (error) return res.status(500).json({ error: 'Erro' });
    const mapped = data.map(o => ({ ...o, loja_nome: o.profiles?.name, loja_telefone: o.profiles?.telefone, loja_cidade: o.profiles?.cidade }));
    res.json({ ofertas: mapped });
});

app.post('/api/cotacoes/aceitar', requireAuth, async (req, res) => {
    const { cotacao_id, oferta_id } = req.body;
    await supabase.from('cotacoes').update({ status: 'Concluído' }).eq('id', cotacao_id);
    const { data, error } = await supabase.from('ofertas').select(`profiles:loja_id (telefone)`).eq('id', oferta_id).single();
    if (error || !data) return res.status(500).json({ error: 'Erro' });
    res.json({ success: true, telefone: data.profiles?.telefone });
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    // Envia email de reset via Supabase
    await supabase.auth.resetPasswordForEmail(email).catch(() => {});
    res.json({ success: true, message: 'Verifique seu e-mail.' });
});

app.post('/api/reset-password', async (req, res) => {
    res.status(400).json({ error: 'Acesse pelo link enviado no e-mail.' });
});

// Handler de erros do multer (tamanho excedido) e erros gerais
app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Arquivo muito grande. Limite: ${MAX_FILE_SIZE / 1024 / 1024} MB.` });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
});

app.listen(port, () => {
    console.log(`Servidor rodando porta ${port}`);
});
