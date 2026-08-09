param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('protect', 'unprotect')]
  [string]$Mode
)

$inputText = [Console]::In.ReadToEnd()
$plainBytes = $null
$protectedBytes = $null

try {
  if ($Mode -eq 'protect') {
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes($inputText)
    $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect(
      $plainBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
  } else {
    $protectedBytes = [Convert]::FromBase64String($inputText.Trim())
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $protectedBytes,
      $null,
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
  }
} finally {
  if ($null -ne $plainBytes) {
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  }
  if ($null -ne $protectedBytes) {
    [Array]::Clear($protectedBytes, 0, $protectedBytes.Length)
  }
}
