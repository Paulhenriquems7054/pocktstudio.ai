# 🚨 Solução para Erro 429 - Cota Excedida do Google Gemini

## 📊 Diagnóstico

Sua nova chave API `AIzaSyD6q7amR6G__3e08bkZ0yGDcHx2eXcoy1g` está retornando:

```
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0
```

**Isso significa que o limite está em ZERO (0)!**

---

## 🔍 Causas Possíveis

### 1. **API Free Tier Não Habilitada**
O Google Gemini mudou recentemente suas políticas de acesso gratuito.

### 2. **Projeto sem Configuração Adequada**
A chave API pode não estar vinculada a um projeto com permissões corretas.

### 3. **Região ou Conta Bloqueada**
Algumas regiões ou contas novas podem ter restrições.

---

## ✅ Soluções (Execute em Ordem)

### **Solução 1: Reconfigurar Chave API Completamente**

#### Passo 1: Acesse o Google AI Studio
🔗 https://aistudio.google.com/

#### Passo 2: Verifique sua Conta
- ✅ Certifique-se de estar logado na conta Google correta
- ✅ Aceite todos os termos de serviço se aparecer um banner

#### Passo 3: Teste o Chat do AI Studio
- Vá em "Prompt" no menu lateral
- Digite uma mensagem de teste: "Olá"
- **Se funcionar:** sua conta tem acesso
- **Se não funcionar:** sua conta pode ter restrições

#### Passo 4: Crie Nova API Key no AI Studio
1. Clique em "Get API Key" no menu
2. Selecione **"Create API key in new project"** (não use projeto existente)
3. Copie a nova chave
4. Teste a chave no arquivo `test-api.html` que criei

---

### **Solução 2: Habilitar API no Google Cloud Console**

#### Passo 1: Acesse o Console
🔗 https://console.cloud.google.com/

#### Passo 2: Crie um Novo Projeto
1. Clique no seletor de projetos (topo esquerdo)
2. Clique em "Novo Projeto"
3. Nome: "PocketStudio"
4. Crie

#### Passo 3: Habilite a API
1. Vá em "APIs & Services" > "Library"
2. Busque por "Generative Language API"
3. Clique em "Enable"
4. Aguarde alguns minutos

#### Passo 4: Crie Credenciais
1. Vá em "APIs & Services" > "Credentials"
2. Clique em "Create Credentials" > "API Key"
3. Copie a chave
4. (Opcional) Restrinja a chave para maior segurança

---

### **Solução 3: Configurar Billing (Se Necessário)**

Alguns modelos do Gemini agora **requerem billing ativo**, mesmo que você use apenas o free tier.

#### Passo 1: Configure Billing
🔗 https://console.cloud.google.com/billing

1. Crie uma conta de billing
2. **Não se preocupe:** O free tier continua gratuito!
3. Você só paga se exceder os limites

#### Passo 2: Vincule ao Projeto
1. Vá ao projeto "PocketStudio"
2. Em "Billing", vincule a conta de billing
3. Aguarde alguns minutos

---

### **Solução 4: Usar Modelo Alternativo (Teste)**

Se o problema persistir, o modelo `gemini-2.5-flash-image-preview` pode ter restrições especiais.

**Modelos Alternativos:**
- ✅ `gemini-1.5-flash` - Texto (mais disponível)
- ✅ `gemini-1.5-pro` - Texto (mais poderoso)
- ⚠️ `gemini-2.0-flash-exp` - Experimental

**Nota:** Modelos de texto não geram imagens diretamente, mas podem gerar descrições muito detalhadas.

---

## 🧪 Como Testar

### Use o arquivo `test-api.html` que criei:

1. Abra `test-api.html` no navegador
2. Cole sua chave API
3. Clique em "Testar API"
4. Veja se funciona

**Se funcionar:** O problema é específico do modelo de imagem
**Se não funcionar:** O problema é com a configuração da conta/projeto

---

## 📌 Limites do Free Tier (Atualizado 2025)

### Gemini 1.5 Flash (Texto)
- ✅ **15 RPM** (requisições por minuto)
- ✅ **1.500 RPD** (requisições por dia)
- ✅ **1M tokens/minuto**

### Gemini 2.5 Flash Image Preview
- ⚠️ **Limites mais restritos**
- ⚠️ **Pode requerer billing em algumas contas**
- ⚠️ **Preview = menos estável**

---

## 🎯 Recomendação Final

**MELHOR SOLUÇÃO:**

1. ✅ Acesse https://aistudio.google.com/
2. ✅ Crie uma **nova chave API em NOVO projeto**
3. ✅ Se necessário, configure **billing** (você ainda terá free tier!)
4. ✅ Teste a nova chave no `test-api.html`
5. ✅ Use a chave que funcionar no PocketStudio

---

## 📞 Suporte

Se o problema persistir:
- 📖 Documentação: https://ai.google.dev/gemini-api/docs
- 🐛 Limites: https://ai.google.dev/gemini-api/docs/rate-limits
- 💬 Comunidade: https://discuss.ai.google.dev/

---

**Última atualização:** 9 de outubro de 2025

