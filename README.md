# 🚗 Universo do Carro

Plataforma PWA de cotação de autopeças com notificações WhatsApp em tempo real.

## 🏗️ Arquitetura

```
Frontend (PWA) → Node.js/Express (Proxy) → Supabase (DB)
                                         → n8n → Z-API → WhatsApp
```

## 📋 Funcionalidades

- ✅ Cadastro e login de compradores e lojistas (com validação de CNPJ)
- ✅ Envio de cotações com foto da peça
- ✅ Notificação automática via WhatsApp para lojistas da cidade
- ✅ Painel do lojista com ofertas em tempo real
- ✅ Fechamento de venda com redirecionamento para WhatsApp

## 🚀 Deploy na VPS

### 1. Clone o repositório
```bash
git clone https://github.com/SEU_USUARIO/universo-do-carro.git
cd universo-do-carro
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure as variáveis de ambiente
```bash
cp .env.example .env
nano .env
```

Preencha o `.env` com:
```
SUPABASE_URL=https://xkiqkzrmavnqchqkyyvw.supabase.co
SUPABASE_SERVICE_KEY=eyJ...sua_chave_aqui
PORT=3000
```

### 4. Instale o PM2 e inicie o servidor
```bash
npm install -g pm2
pm2 start server.js --name "universo-do-carro"
pm2 save
pm2 startup
```

### 5. Configure o Nginx (proxy reverso)
```nginx
server {
    listen 80;
    server_name seudominio.com.br;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 🛠️ Stack Técnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML5, CSS (Tailwind), JavaScript PWA |
| Backend | Node.js + Express |
| Banco de Dados | Supabase (PostgreSQL) |
| Automação | n8n |
| WhatsApp | Z-API |
| Hospedagem | VPS (Hostinger) |

## 📁 Estrutura do Projeto

```
universo-do-carro/
├── server.js          # Servidor Express (API Gateway)
├── index.html         # Landing page
├── login.html         # Cadastro e login
├── comprador.html     # Painel do comprador
├── cotacao.html       # Formulário de cotação
├── loja.html          # Painel do lojista
├── admin.html         # Painel administrativo
├── manifest.json      # PWA manifest
├── sw.js              # Service Worker
├── assets/            # Imagens e recursos
└── uploads/           # Fotos enviadas pelos usuários
```
