$ErrorActionPreference = 'SilentlyContinue'
$hosts = @('dmmotorgroup.com','www.dmmotorgroup.com')
$servers = @(@{n='Namecheap authoritative (dns1)';s='dns1.registrar-servers.com'}, @{n='Cloudflare 1.1.1.1';s='1.1.1.1'}, @{n='Google 8.8.8.8';s='8.8.8.8'})
foreach ($srv in $servers) {
  Write-Output ("=== " + $srv.n + " ===")
  foreach ($h in $hosts) {
    $rows = Resolve-DnsName $h -Server $srv.s -ErrorAction SilentlyContinue | Where-Object { $_.Type -in @('A','AAAA','CNAME') }
    if (-not $rows) { Write-Output ("  " + $h + " -> NO RECORD") }
    foreach ($r in $rows) {
      $v = if ($r.IPAddress) { $r.IPAddress } else { $r.NameHost }
      Write-Output ("  " + $h + "  " + $r.Type + "  " + $v)
    }
  }
}
Write-Output "=== SITE TEST (forced correct Cloudflare edge) ==="
foreach ($h in @('dmmotorgroup.com','www.dmmotorgroup.com')) {
  $out = & curl.exe -4 -sS -o NUL -w "%{http_code}" --resolve "${h}:443:172.66.44.171" ("https://" + $h + "/api/health") 2>$null
  Write-Output ("  https://" + $h + "/api/health -> " + $out)
}
