# Script para iniciar o servidor de desenvolvimento na porta 3001
Write-Host "Iniciando servidor Vite na porta 3001..." -ForegroundColor Green
Write-Host "Diretório: $(Get-Location)" -ForegroundColor Yellow
Write-Host "Verificando arquivos..." -ForegroundColor Yellow

if (Test-Path "package.json") {
    Write-Host "✅ package.json encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ package.json NÃO encontrado" -ForegroundColor Red
    exit 1
}

if (Test-Path "index.html") {
    Write-Host "✅ index.html encontrado" -ForegroundColor Green
} else {
    Write-Host "❌ index.html NÃO encontrado" -ForegroundColor Red
    exit 1
}

Write-Host "Iniciando servidor..." -ForegroundColor Green
npx vite --port 3001
