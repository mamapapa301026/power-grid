$ErrorActionPreference = 'Stop'

$openssl = 'C:\xampp\apache\bin\openssl.exe'
if (-not (Test-Path -LiteralPath $openssl -PathType Leaf)) {
  throw "OpenSSL was not found at $openssl. Install or repair XAMPP Apache."
}
$env:OPENSSL_CONF = 'C:\xampp\apache\conf\openssl.cnf'

$certificateDirectory = Join-Path $env:LOCALAPPDATA 'PowerGridMonitor\certs'
New-Item -ItemType Directory -Force -Path $certificateDirectory | Out-Null

$caKey = Join-Path $certificateDirectory 'local-ca.key'
$caCertificate = Join-Path $certificateDirectory 'local-ca.crt'
$caCertificateDer = Join-Path $certificateDirectory 'local-ca.cer'
$serverKey = Join-Path $certificateDirectory 'localhost.key'
$serverRequest = Join-Path $certificateDirectory 'localhost.csr'
$serverCertificate = Join-Path $certificateDirectory 'localhost.crt'
$extensionsFile = Join-Path $certificateDirectory 'localhost.ext'

if (-not (Test-Path -LiteralPath $caCertificate -PathType Leaf)) {
  & $openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 `
    -keyout $caKey -out $caCertificate -subj '/CN=PowerGrid Local Development CA' `
    -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' `
    -addext 'keyUsage=critical,keyCertSign,cRLSign'
  if ($LASTEXITCODE -ne 0) {
    throw 'OpenSSL failed to create the local certificate authority.'
  }
}

if (-not (Test-Path -LiteralPath $serverCertificate -PathType Leaf) -or
    -not (Test-Path -LiteralPath $serverKey -PathType Leaf)) {
  & $openssl req -new -newkey rsa:2048 -sha256 -nodes `
    -keyout $serverKey -out $serverRequest -subj '/CN=localhost'
  if ($LASTEXITCODE -ne 0) {
    throw 'OpenSSL failed to create the localhost certificate request.'
  }

  @'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
'@ | Set-Content -LiteralPath $extensionsFile -Encoding ascii

  & $openssl x509 -req -in $serverRequest -CA $caCertificate -CAkey $caKey `
    -CAcreateserial -out $serverCertificate -days 825 -sha256 -extfile $extensionsFile
  if ($LASTEXITCODE -ne 0) {
    throw 'OpenSSL failed to sign the localhost HTTPS certificate.'
  }
  Remove-Item -LiteralPath $serverRequest, $extensionsFile
}

$fingerprintOutput = & $openssl x509 -in $caCertificate -noout -fingerprint -sha1
if ($LASTEXITCODE -ne 0) {
  throw 'OpenSSL could not read the local CA certificate.'
}
$thumbprint = (($fingerprintOutput -split '=', 2)[1] -replace ':', '').Trim()
$trustedCertificate = Get-ChildItem Cert:\CurrentUser\Root |
  Where-Object Thumbprint -eq $thumbprint
if (-not $trustedCertificate) {
  $answer = Read-Host 'Trust the PowerGrid local CA for this Windows user only? (Y/N)'
  if ($answer -notmatch '^(Y|YES)$') {
    throw 'Local HTTPS setup was cancelled because the certificate authority was not trusted.'
  }

  & $openssl x509 -in $caCertificate -outform DER -out $caCertificateDer
  if ($LASTEXITCODE -ne 0) {
    throw 'OpenSSL failed to convert the local CA certificate for Windows.'
  }
  & certutil.exe -user -addstore -f Root $caCertificateDer
  if ($LASTEXITCODE -ne 0) {
    throw 'Windows could not add the local CA to the current user certificate store.'
  }
}

Write-Output 'Local HTTPS certificate is ready for https://localhost:5173/.'
