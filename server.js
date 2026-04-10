require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase 
const supabaseUrl = 'https://xkiqkzrmavnqchqkyyvw.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZjI6InhraXFrenJtYXZucWNoa3l5dndpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcxMjc1MzMyNSwiZXhwIjoyMDI4MzI5MzI1fQ.V5zabP6USwGJFLKX7SoaiJci1M6g7GNJNul_X7R5SWY';

// AVISO: A Service Role Key do Supabase deve começar com 'eyJ' (formato JWT)
if (!supabaseKey.startsWith('eyJ')) {
    console.warn('\n⚠️  ATENÇÃO: A SUPABASE_SERVICE_KEY parece inválida!');
    console.warn('   A chave deve ser a "service_role" do painel Supabase > Settings > API.');
    console.warn('   Ela começa com eyJ... (formato JWT). A atual começa com:', supabaseKey.substring(0, 10));
    console.warn('   Defina a variável de ambiente: SET SUPABASE_SERVICE_KEY=eyJ...\n');
}

// Criando cliente isolado (sem persistir sessão para evitar que o login de um bloqueie o cadastro do outro)
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

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

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Email ou senha inválidos.' });

    const { data: profile, error: profError } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();

    if (profError || !profile) return res.status(500).json({ error: 'Erro ao carregar seu perfil na nuvem.' });

    res.json({ success: true, user: profile, role: profile.role });
});

app.get('/api/users', async (req, res) => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Erro' });
    res.json({ users: data });
});

app.post('/api/cotacoes', upload.single('foto'), async (req, res) => {
    const { user_id, marca, modelo, ano, chassi, peca, descricao, cidade } = req.body;
    if (!user_id || !peca || !cidade) return res.status(400).json({ error: 'Faltam dados. A cidade e a peça são obrigatórias.' });

    let foto_url = null;
    if (req.file) {
        const fileName = `${Date.now()}_${req.file.originalname}`;
        const { error: uploadError } = await supabase.storage.from('uploads').upload(fileName, req.file.buffer, { contentType: req.file.mimetype });
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

app.post('/api/ofertas', async (req, res) => {
    const { cotacao_id, loja_id, valor, mensagem, garantia, peca_tipo } = req.body;
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

app.post('/api/cotacoes/aceitar', async (req, res) => {
    const { cotacao_id, oferta_id } = req.body;
    await supabase.from('cotacoes').update({ status: 'Concluído' }).eq('id', cotacao_id);
    const { data, error } = await supabase.from('ofertas').select(`profiles:loja_id (telefone)`).eq('id', oferta_id).single();
    if (error || !data) return res.status(500).json({ error: 'Erro' });
    res.json({ success: true, telefone: data.profiles?.telefone });
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    // Gera um token mock para ambiente de desenvolvimento
    const token_mock = Math.random().toString(36).substring(2, 10).toUpperCase();
    console.log(`[FORGOT-PWD] Token mock para ${email}: ${token_mock}`);
    // Tenta enviar email real via Supabase (pode falhar em dev sem SMTP configurado)
    await supabase.auth.resetPasswordForEmail(email).catch(() => {});
    res.json({ success: true, message: 'Verifique seu e-mail.', token_mock });
});

app.post('/api/reset-password', async (req, res) => {
    res.status(400).json({ error: 'Acesse pelo link enviado no e-mail.' });
});

app.listen(port, () => {
    console.log(`Servidor rodando porta ${port}`);
});
