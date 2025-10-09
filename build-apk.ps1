# Script para gerar APK do Pocket Studio
Write-Host "🚀 Iniciando processo de build do APK..." -ForegroundColor Green

# 1. Build do projeto web
Write-Host "📦 Fazendo build do projeto web..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro no build do projeto web!" -ForegroundColor Red
    exit 1
}

# 2. Sincronizar com Android
Write-Host "🔄 Sincronizando com Android..." -ForegroundColor Yellow
npx cap sync android

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro na sincronização com Android!" -ForegroundColor Red
    exit 1
}

# 3. Abrir Android Studio
Write-Host "📱 Abrindo Android Studio..." -ForegroundColor Yellow
Write-Host "No Android Studio:" -ForegroundColor Cyan
Write-Host "1. Aguarde o Gradle sync terminar" -ForegroundColor White
Write-Host "2. Vá em Build > Build Bundle(s) / APK(s) > Build APK(s)" -ForegroundColor White
Write-Host "3. O APK será gerado em: android\app\build\outputs\apk\debug\" -ForegroundColor White

npx cap open android

Write-Host "✅ Processo concluído! Siga as instruções acima no Android Studio." -ForegroundColor Green
