# 📱 Como Instalar o APK do PocketStudio no PC

Este guia explica como executar o aplicativo Android do PocketStudio no seu computador Windows.

---

## 📂 Localização do APK

O arquivo APK está localizado em:
```
E:\pocktstudio\Pocktstudio-main\android\app\build\outputs\apk\debug\app-debug.apk
```

**Informações do APK:**
- **Nome do App:** Pocket Studio
- **Package ID:** com.pocketstudio.app
- **Versão:** 1.0 (Build 1)
- **Tipo:** Debug (não assinado)
- **Tamanho:** ~10-15 MB

---

## 🎮 Método 1: Android Studio Emulator (Recomendado para Desenvolvedores)

### ⭐ **Vantagens:**
- ✅ Mais preciso e fiel ao Android real
- ✅ Melhor para testes e desenvolvimento
- ✅ Você já tem instalado!
- ✅ Várias versões do Android disponíveis

### 📋 **Passos:**

#### **1. Abrir o Projeto no Android Studio**

Abra o PowerShell no diretório do projeto e execute:
```powershell
npx cap open android
```

Ou abra o Android Studio manualmente e selecione a pasta:
```
E:\pocktstudio\Pocktstudio-main\android
```

#### **2. Criar um Dispositivo Virtual (AVD)**

1. No Android Studio, clique no ícone **"Device Manager"** (📱) na barra lateral direita
2. Clique em **"Create Device"**
3. **Escolha um dispositivo:**
   - Recomendado: **Pixel 6** ou **Pixel 7**
   - Clique em **"Next"**

4. **Selecione uma System Image:**
   - Recomendado: **Android 13 (Tiramisu)** ou **Android 14 (UpsideDownCake)**
   - Se não estiver baixada, clique em **"Download"**
   - Clique em **"Next"**

5. **Configure o AVD:**
   - Nome: **"Pocket Studio Test Device"**
   - Deixe as configurações padrão
   - Clique em **"Finish"**

#### **3. Iniciar o Emulador**

1. No **Device Manager**, clique no botão ▶️ (Play) ao lado do dispositivo criado
2. Aguarde o emulador iniciar (pode levar 1-2 minutos na primeira vez)

#### **4. Instalar o APK no Emulador**

**Opção A: Arrastar e Soltar**
1. Arraste o arquivo `app-debug.apk` para a janela do emulador
2. Aguarde a instalação automática

**Opção B: Via Linha de Comando**
```powershell
# No diretório do projeto
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

**Opção C: Usar o Android Studio**
1. No Android Studio, clique em **Run** → **"Run 'app'"**
2. Selecione o emulador criado
3. O app será instalado e aberto automaticamente

#### **5. Abrir o App**

- O app **Pocket Studio** aparecerá na tela inicial do emulador
- Clique para abrir e usar! 🎉

---

## 🎮 Método 2: BlueStacks (Mais Fácil e Visual)

### ⭐ **Vantagens:**
- ✅ Interface muito amigável
- ✅ Fácil de usar
- ✅ Bom desempenho
- ✅ Parece um celular real

### ⚠️ **Desvantagens:**
- Pode ter anúncios
- Ocupa ~5 GB de espaço

### 📋 **Passos:**

#### **1. Baixar e Instalar o BlueStacks**

1. Acesse: https://www.bluestacks.com/
2. Clique em **"Download BlueStacks"**
3. Execute o instalador baixado
4. Siga o assistente de instalação
5. Aguarde a instalação completa (~10-15 minutos)

#### **2. Configurar o BlueStacks**

1. Abra o BlueStacks
2. Faça login com sua conta Google (opcional, mas recomendado)
3. Complete a configuração inicial

#### **3. Instalar o APK**

**Opção A: Arrastar e Soltar (Mais Fácil)**
1. Arraste o arquivo `app-debug.apk` para a janela do BlueStacks
2. Aguarde a instalação automática (10-30 segundos)
3. O app aparecerá na tela inicial

**Opção B: Menu "Install APK"**
1. Clique no ícone **"Install APK"** na barra lateral do BlueStacks
2. Navegue até: `E:\pocktstudio\Pocktstudio-main\android\app\build\outputs\apk\debug\`
3. Selecione `app-debug.apk`
4. Clique em **"Abrir"**
5. Aguarde a instalação

#### **4. Abrir o App**

1. Na tela inicial do BlueStacks, você verá o ícone **"Pocket Studio"**
2. Clique para abrir
3. Pronto! Use normalmente como se estivesse em um celular 📱

---

## 🚀 Método 3: LDPlayer (Mais Leve)

### ⭐ **Vantagens:**
- ✅ Mais leve que o BlueStacks
- ✅ Menos anúncios
- ✅ Bom para PCs com menos recursos
- ✅ Otimizado para jogos e apps

### 📋 **Passos:**

#### **1. Baixar e Instalar**

1. Acesse: https://www.ldplayer.net/
2. Baixe a versão mais recente (LDPlayer 9)
3. Execute o instalador
4. Siga o assistente de instalação
5. Aguarde a conclusão (~5-10 minutos)

#### **2. Instalar o APK**

1. Abra o LDPlayer
2. **Arraste** o `app-debug.apk` para a janela do emulador
3. Clique em **"Instalar"**
4. Aguarde a instalação

#### **3. Usar o App**

1. Clique no ícone do **Pocket Studio** na tela inicial
2. Use o app! ✨

---

## 🪟 Método 4: Subsistema Windows para Android (WSA) - Apenas Windows 11

### ⭐ **Vantagens:**
- ✅ Nativo do Windows 11
- ✅ Melhor integração com o Windows
- ✅ Desempenho excelente
- ✅ Sem anúncios

### ⚠️ **Requisitos:**
- Windows 11 (não funciona no Windows 10)
- Virtualização habilitada na BIOS

### 📋 **Passos:**

#### **1. Instalar o Subsistema Windows para Android**

1. Abra a **Microsoft Store**
2. Busque por: **"Amazon Appstore"**
3. Clique em **"Obter"** ou **"Instalar"**
4. Aguarde a instalação (instala o WSA automaticamente)
5. Abra o **Amazon Appstore** uma vez para ativar o WSA

#### **2. Habilitar Modo Desenvolvedor**

1. Abra **Configurações do Windows**
2. Vá em **"Aplicativos"** → **"Recursos opcionais"**
3. Procure por **"Subsistema Windows para Android™"**
4. Clique em **"Configurações avançadas"**
5. Ative **"Modo de desenvolvedor"**
6. Anote o **endereço IP** mostrado (geralmente `127.0.0.1:58526`)

#### **3. Instalar o APK via ADB**

No PowerShell, execute:

```powershell
# Conectar ao WSA
adb connect 127.0.0.1:58526

# Verificar se conectou
adb devices

# Instalar o APK
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

#### **4. Abrir o App**

1. O app aparecerá no **Menu Iniciar do Windows**
2. Procure por **"Pocket Studio"**
3. Clique para abrir
4. O app roda como um aplicativo Windows nativo! 🚀

---

## 🌐 Método 5: Rodar no Navegador (Mais Simples!)

### ⭐ **Vantagens:**
- ✅ **MAIS RÁPIDO** - Sem instalação
- ✅ Não precisa de emulador
- ✅ Atualização instantânea
- ✅ Mesma funcionalidade do APK

### 📋 **Passos:**

#### **1. Iniciar o Servidor de Desenvolvimento**

No PowerShell (no diretório do projeto):

```powershell
npm run dev
```

#### **2. Abrir no Navegador**

O navegador abrirá automaticamente em:
```
http://localhost:3001
```

Se não abrir, acesse manualmente: http://localhost:3001/app.html

#### **3. Usar o App**

- ✅ Funciona **exatamente** como o APK
- ✅ Todos os recursos disponíveis
- ✅ Hot reload (atualiza automaticamente ao editar código)

---

## 📊 **Comparação dos Métodos**

| Método | Facilidade | Desempenho | Espaço | Recomendado Para |
|--------|-----------|------------|--------|------------------|
| **Android Studio** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ~3 GB | Desenvolvimento |
| **BlueStacks** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ~5 GB | Uso Geral |
| **LDPlayer** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ~3 GB | PCs Mais Fracos |
| **WSA (Win 11)** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ~2 GB | Windows 11 |
| **Navegador** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 0 GB | **Teste Rápido** |

---

## 🎯 **Minha Recomendação**

### **Para Testar Rapidamente:**
```powershell
npm run dev
```
✅ Abra no navegador e use imediatamente!

### **Para Testar Como APK:**
1. Baixe **BlueStacks**: https://www.bluestacks.com/
2. Arraste o APK para o BlueStacks
3. Pronto!

---

## ⚠️ **Nota Importante sobre a API**

Independente do método escolhido, você ainda precisará:

1. **Configurar uma chave API válida** do Google Gemini
2. **Com billing habilitado** (para desbloquear o free tier)
3. Siga o guia: `SOLUCAO-ERRO-429.md`

Sem uma chave API válida, o app não conseguirá gerar imagens, seja no celular, emulador ou navegador.

---

## 🚀 **Comandos Rápidos**

### **Rodar no Navegador (Mais Rápido):**
```powershell
npm run dev
```

### **Instalar no Android Studio Emulator:**
```powershell
# Abrir Android Studio
npx cap open android

# Depois de criar o emulador, instalar APK:
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

### **Rebuild do APK:**
```powershell
npm run build:apk
```

---

## 📞 **Precisa de Ajuda?**

Se tiver dúvidas sobre qualquer método, me avise que posso ajudar com instruções mais detalhadas!

---

**Última atualização:** 9 de outubro de 2025
**Versão do Guia:** 1.0

