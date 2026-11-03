[CmdletBinding()]
param(
  [switch]$EmitPassword
)

$ErrorActionPreference = 'Stop'
$mysql = 'C:\xampp\mysql\bin\mysql.exe'
if (-not (Test-Path -LiteralPath $mysql -PathType Leaf)) {
  throw "XAMPP MariaDB client was not found at $mysql."
}

$dataDirectory = Join-Path $env:LOCALAPPDATA 'PowerGridMonitor'
$credentialPath = Join-Path $dataDirectory 'database.credential.xml'
$sqlPath = Join-Path $dataDirectory 'create-database-user.sql'
$outputPath = Join-Path $dataDirectory 'database-setup.out'
$errorPath = Join-Path $dataDirectory 'database-setup.err'
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null

$credential = $null
if (Test-Path -LiteralPath $credentialPath -PathType Leaf) {
  $credential = Import-Clixml -LiteralPath $credentialPath
} else {
  $query = & $mysql --protocol=TCP --host=127.0.0.1 --port=3306 --user=root `
    --connect-timeout=5 --batch --skip-column-names `
    --execute="SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='powergrid_monitor'; SELECT COUNT(*) FROM mysql.user WHERE user='powergrid_app' AND host='127.0.0.1';"
  if ($LASTEXITCODE -ne 0) {
    throw 'Cannot configure the app account. Import the database, start XAMPP MySQL, and follow the database-user instructions in README.md.'
  }
  if ($query.Count -lt 2 -or [int]$query[0] -lt 1) {
    throw 'The powergrid_monitor schema is missing. Import database/powergrid_monitor.sql in phpMyAdmin first.'
  }
  if ([int]$query[1] -ne 0) {
    throw 'A powergrid_app account already exists. Set its DB_USER and DB_PASSWORD in the current terminal before starting.'
  }

  $passwordBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
  $password = ([BitConverter]::ToString($passwordBytes) -replace '-', '').ToLowerInvariant()
  $sql = "CREATE USER 'powergrid_app'@'127.0.0.1' IDENTIFIED BY '$password';`r`nGRANT SELECT, INSERT, UPDATE, DELETE ON powergrid_monitor.* TO 'powergrid_app'@'127.0.0.1';`r`n"
  Set-Content -LiteralPath $sqlPath -Value $sql -Encoding ascii

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule(
    $identity.User,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $sqlPath -AclObject $acl

  $arguments = '/d /c ""{0}" --protocol=TCP --host=127.0.0.1 --port=3306 --user=root --connect-timeout=5 < "{1}""' -f $mysql, $sqlPath
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList $arguments `
    -Wait -PassThru -NoNewWindow -RedirectStandardOutput $outputPath `
    -RedirectStandardError $errorPath
  Remove-Item -LiteralPath $sqlPath -Force -ErrorAction SilentlyContinue
  if ($process.ExitCode -ne 0) {
    $detail = Get-Content -LiteralPath $errorPath -Raw -ErrorAction SilentlyContinue
    throw "Could not create the local database account. $detail"
  }

  $securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
  $credential = New-Object Management.Automation.PSCredential('powergrid_app', $securePassword)
  $credential | Export-Clixml -LiteralPath $credentialPath
  $credentialAcl = New-Object Security.AccessControl.FileSecurity
  $credentialAcl.SetOwner($identity.User)
  $credentialAcl.SetAccessRuleProtection($true, $false)
  [void]$credentialAcl.AddAccessRule($rule)
  Set-Acl -LiteralPath $credentialPath -AclObject $credentialAcl
  Remove-Item -LiteralPath $outputPath, $errorPath -Force -ErrorAction SilentlyContinue
}

if ($EmitPassword) {
  Write-Output $credential.GetNetworkCredential().Password
} else {
  Write-Output 'Local database credentials are ready.'
}
