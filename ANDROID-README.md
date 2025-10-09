# 📱 Pocket Studio - Android APK

Este guia explica como gerar o APK do Pocket Studio para Android.

## 🚀 Geração Rápida do APK

### Método 1: Script Automatizado
```bash
npm run build:apk
```

### Método 2: Comandos Manuais
```bash
# 1. Build do projeto web
npm run build

# 2. Sincronizar com Android
npm run android:sync

# 3. Abrir Android Studio
npm run android:open
```

## 📋 Pré-requisitos

### 1. Android Studio
- Baixe e instale o [Android Studio](https://developer.android.com/studio)
- Instale o Android SDK (API 33 ou superior)
- Configure as variáveis de ambiente ANDROID_HOME

### 2. Java Development Kit (JDK)
- Instale o JDK 17 ou superior
- Configure a variável JAVA_HOME

## 🔧 Configuração do Projeto

O projeto já está configurado com:
- **App ID:** `com.pocketstudio.app`
- **App Name:** `Pocket Studio`
- **Web Directory:** `dist`
- **Android Scheme:** `https`

## 📱 Geração do APK

### No Android Studio:
1. Abra o projeto em `android/`
2. Aguarde o Gradle sync terminar
3. Vá em **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**
4. O APK será gerado em: `android/app/build/outputs/apk/debug/`

### Via Terminal (se tiver Gradle configurado):
```bash
cd android
./gradlew assembleDebug
```

## 📦 Estrutura do APK

O APK inclui:
- ✅ Página de apresentação (`index.html`)
- ✅ App principal (`app.html`)
- ✅ Imagem de fundo 3D
- ✅ Ícone de câmera animado
- ✅ Sistema de chaves API flexível
- ✅ PWA completo
- ✅ Assets otimizados

## 🎯 Funcionalidades do App

- **Página inicial:** Apresentação com imagem 3D
- **Geração de imagens:** IA com Google Gemini
- **Câmera:** Acesso direto à câmera do dispositivo
- **PWA:** Funciona offline após instalação
- **Chaves API:** Aceita qualquer chave válida

## 🔄 Atualizações

Para atualizar o app:
1. Faça as mudanças no código
2. Execute `npm run build:apk`
3. Gere novo APK no Android Studio

## 📱 Instalação

1. Gere o APK seguindo os passos acima
2. Transfira o APK para o dispositivo Android
3. Habilite "Fontes desconhecidas" nas configurações
4. Instale o APK

## 🐛 Solução de Problemas

### Erro de Build
```bash
# Limpar cache
npm run build
npx cap clean android
npx cap sync android
```

### Gradle Sync Failed
- Verifique se o Android Studio está atualizado
- Verifique se o JDK está configurado corretamente
- Tente "File" > "Sync Project with Gradle Files"

## 📞 Suporte

Para problemas específicos do Android, consulte:
- [Capacitor Android Docs](https://capacitorjs.com/docs/android)
- [Android Studio Docs](https://developer.android.com/studio)
