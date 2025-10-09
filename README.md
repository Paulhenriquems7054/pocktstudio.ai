# 📸 Pockt Studio - Gerador de Imagens com IA

Aplicativo de geração de imagens usando a API do Google Gemini com React e Tailwind CSS.

## 🚀 Recursos

- 🖼️ Geração de imagens com IA
- 🎨 Múltiplos templates e estilos
- 💬 Assistente de chat para criação de prompts
- ✨ Melhoramento automático de prompts
- 📱 Interface responsiva e moderna
- 🎭 Efeitos e animações com Framer Motion

## 📋 Pré-requisitos

- Node.js (versão 16 ou superior)
- npm ou yarn
- Chave da API do Google Gemini

## 🔧 Instalação

1. **Clone o repositório ou navegue até a pasta do projeto**

2. **Instale as dependências:**
```bash
npm install
```

3. **Configure a API Key:**

   Crie um arquivo `.env` na raiz do projeto:
```bash
cp .env.example .env
```

   Edite o arquivo `.env` e adicione sua chave da API:
```
VITE_GEMINI_API_KEY=AIzaSyAM26m25JiBAWoQfDo3ND05WzopM6bc3pU
```

4. **Inicie o servidor de desenvolvimento:**
```bash
npm run dev
```

5. **Abra o navegador em:** `http://localhost:3000`

## 🏗️ Build para Produção

Para criar uma versão otimizada para produção:

```bash
npm run build
```

Para visualizar a build de produção:

```bash
npm run preview
```

## 📁 Estrutura do Projeto

```
Pocktstudio-main/
├── public/
│   ├── favicon.png          # Favicon do site
│   ├── logo-512.png         # Logo 512x512
│   ├── logo-1024.png        # Logo 1024x1024
│   ├── manifest.json        # Manifesto PWA
│   └── res/                 # Ícones do sistema (múltiplas resoluções)
│       ├── mipmap-mdpi/
│       ├── mipmap-hdpi/
│       ├── mipmap-xhdpi/
│       ├── mipmap-xxhdpi/
│       └── mipmap-xxxhdpi/
├── src/
│   ├── App.jsx              # Componente principal
│   ├── main.jsx             # Ponto de entrada
│   └── index.css            # Estilos globais
├── index.html               # Template HTML
├── package.json             # Dependências
├── vite.config.js           # Configuração do Vite
├── tailwind.config.js       # Configuração do Tailwind
└── .env                     # Variáveis de ambiente
```

## 🎨 Tecnologias Utilizadas

- **React** - Biblioteca UI
- **Vite** - Build tool e dev server
- **Tailwind CSS** - Framework CSS
- **Framer Motion** - Animações
- **Google Gemini API** - Geração de imagens com IA

## ⚠️ Nota de Segurança

**IMPORTANTE:** Nunca compartilhe sua chave da API publicamente. O arquivo `.env` está incluído no `.gitignore` para evitar que seja enviado para repositórios Git.

## 📝 Licença

Este projeto é de uso pessoal.

## 🤝 Suporte

Para problemas ou dúvidas, consulte a documentação da API do Google Gemini:
https://ai.google.dev/docs

---

Desenvolvido com ❤️ usando React e Google Gemini

