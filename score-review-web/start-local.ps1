param(
  [Parameter(Mandatory = $true)]
  [string]$AdminPassword,
  [int]$Port = 4173
)

$env:SCORE_REVIEW_PASSWORD = $AdminPassword
$env:SCORE_REVIEW_PORT = [string]$Port
$env:SCORE_REVIEW_HOST = '0.0.0.0'
node (Join-Path $PSScriptRoot 'server.js')
