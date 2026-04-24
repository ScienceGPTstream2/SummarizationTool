$ErrorActionPreference = "Stop"

# Business-hours scaler for Azure Container Apps.
# Night mode uses minReplicas=0 and maxReplicas=1 because ACA does not support
# maxReplicas=0.

param(
    [ValidateSet("auto", "day", "night")]
    [string]$Mode = "auto",
    [string]$ResourceGroup = "HcSx-ScienceGPT3-XerographicMockingbird-vNet-rg",
    [string]$Timezone = "Eastern Standard Time",
    [string]$SubscriptionId = ""
)

$Apps = @(
    "summarization-frontend",
    "summarization-backend",
    "docling-service",
    "vllm-service"
)

$DayMin = 1
$DayMax = 1
$NightMin = 0
$NightMax = 1

if ($Mode -eq "auto") {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById($Timezone)
    $now = [System.TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $tz)
    $isWeekday = [int]$now.DayOfWeek -ge 1 -and [int]$now.DayOfWeek -le 5
    $isBusinessHours = $now.Hour -ge 9 -and $now.Hour -lt 17
    $Mode = if ($isWeekday -and $isBusinessHours) { "day" } else { "night" }
}

if ($Mode -eq "day") {
    $MinReplicas = $DayMin
    $MaxReplicas = $DayMax
} else {
    $MinReplicas = $NightMin
    $MaxReplicas = $NightMax
}

Write-Host "Applying ACA scale mode='$Mode' timezone='$Timezone' minReplicas=$MinReplicas maxReplicas=$MaxReplicas" -ForegroundColor Cyan

foreach ($App in $Apps) {
    Write-Host "→ Updating $App" -ForegroundColor Yellow
    $args = @(
        "containerapp", "update",
        "--name", $App,
        "--resource-group", $ResourceGroup,
        "--min-replicas", "$MinReplicas",
        "--max-replicas", "$MaxReplicas",
        "--output", "none"
    )
    if ($SubscriptionId) {
        $args += @("--subscription", $SubscriptionId)
    }
    az @args
}

$listArgs = @(
    "containerapp", "list",
    "--resource-group", $ResourceGroup,
    "--query", "[].{Name:name, Min:properties.template.scale.minReplicas, Max:properties.template.scale.maxReplicas, Status:properties.runningStatus}",
    "--output", "table"
)
if ($SubscriptionId) {
    $listArgs += @("--subscription", $SubscriptionId)
}
az @listArgs