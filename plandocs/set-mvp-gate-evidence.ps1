param(
  [Parameter(Mandatory = $true)][string]$SliceKey,
  [string]$AutomatedEvidence,
  [string]$ManualEvidence,
  [string]$Notes
)

$ErrorActionPreference = 'Stop'

$trackerDataPath = 'plandocs/2026-04-03-aegis-mvp-tracker-data.json'
$refreshScriptPath = 'plandocs\\revise-mvp-tracker.ps1'

if (-not (Test-Path $trackerDataPath)) {
  throw "Tracker data not found at $trackerDataPath"
}

if (
  -not $PSBoundParameters.ContainsKey('AutomatedEvidence') -and
  -not $PSBoundParameters.ContainsKey('ManualEvidence') -and
  -not $PSBoundParameters.ContainsKey('Notes')
) {
  throw 'Provide at least one of -AutomatedEvidence, -ManualEvidence, or -Notes.'
}

$tracker = Get-Content -Path $trackerDataPath -Raw | ConvertFrom-Json
$slice = $tracker.slices | Where-Object { $_.key -eq $SliceKey } | Select-Object -First 1

if (-not $slice) {
  throw "Slice $SliceKey was not found in $trackerDataPath"
}

if (-not ($slice.PSObject.Properties.Name -contains 'evidence_automated')) {
  $slice | Add-Member -NotePropertyName 'evidence_automated' -NotePropertyValue 'pending'
}
if (-not ($slice.PSObject.Properties.Name -contains 'evidence_manual')) {
  $slice | Add-Member -NotePropertyName 'evidence_manual' -NotePropertyValue 'pending'
}
if (-not ($slice.PSObject.Properties.Name -contains 'evidence_notes')) {
  $slice | Add-Member -NotePropertyName 'evidence_notes' -NotePropertyValue ''
}
if (-not ($slice.PSObject.Properties.Name -contains 'evidence_updated_at')) {
  $slice | Add-Member -NotePropertyName 'evidence_updated_at' -NotePropertyValue ''
}

if ($PSBoundParameters.ContainsKey('AutomatedEvidence')) {
  $slice.evidence_automated = $AutomatedEvidence
}
if ($PSBoundParameters.ContainsKey('ManualEvidence')) {
  $slice.evidence_manual = $ManualEvidence
}
if ($PSBoundParameters.ContainsKey('Notes')) {
  $slice.evidence_notes = $Notes
}

$slice.evidence_updated_at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
$tracker.generated_at = $slice.evidence_updated_at

$tracker | ConvertTo-Json -Depth 8 | Set-Content -Path $trackerDataPath

powershell -NoProfile -ExecutionPolicy Bypass -File $refreshScriptPath | Out-Null

Write-Output "UPDATED_SLICE=$SliceKey"
Write-Output "TRACKER_JSON=$trackerDataPath"
Write-Output 'TRACKER_MD=plandocs/2026-04-03-aegis-mvp-tracker.md'
