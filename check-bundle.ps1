$ErrorActionPreference = 'Stop'
$bundlePath = "C:\Users\GABRIEL\Documents\DividePass\dist\assets\index-lGWbrukA.js"
$bundle = Get-Content $bundlePath -Raw -Encoding UTF8

$checks = @(
    "seenIds",
    "normalizeToMonthly", 
    "subscriptionItems",
    "hasValidData",
    "totalOfficialMonthly",
    "getBillingLabel",
    "getSavingsSummary",
    "calculateUserSavings",
    "isEligible",
    "getAdminAlerts",
    "fmtPercentage"
)

Write-Host "Local bundle analysis (index-lGWbrukA.js):"
foreach ($c in $checks) {
    $present = $bundle.Contains($c)
    $result = if ($present) { "YES" } else { "NO" }
    Write-Host "  $c : $result"
}

Write-Host ""
Write-Host "Additional checks:"
Write-Host "  UserDashboard: $($bundle.Contains('UserDashboard'))"
Write-Host "  Supabase URL: $($bundle.Contains('lasoouwboxspstqvjbsv'))"
Write-Host "  economia: $($bundle.Contains('economia'))"
Write-Host "  Single chunk: $(-not ($bundle -match '`"chunk-'))"
Write-Host "  Bundle size: $($bundle.Length) bytes"
