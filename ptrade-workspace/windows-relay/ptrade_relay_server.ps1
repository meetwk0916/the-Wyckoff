param(
    [int]$Port = 19092
)

$ErrorActionPreference = 'Stop'

$script:LastIngestAt = ''
$script:LastPayload = $null
$script:OrderFlows = @{}

function Get-BaseUrl {
    return "http://127.0.0.1:$Port"
}

function Send-Json {
    param(
        [System.Net.HttpListenerContext]$Context,
        [int]$StatusCode,
        [object]$Payload
    )

    $json = $Payload | ConvertTo-Json -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $response = $Context.Response
    $response.StatusCode = $StatusCode
    $response.ContentType = 'application/json; charset=utf-8'
    $response.Headers['Access-Control-Allow-Origin'] = '*'
    $response.Headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    $response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
}

function Read-Body {
    param([System.Net.HttpListenerRequest]$Request)
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    try {
        return $reader.ReadToEnd()
    } finally {
        $reader.Close()
    }
}

function Normalize-Symbol {
    param([object]$Symbol)
    if ($null -eq $Symbol) { return '002594.SZ' }
    $text = [string]$Symbol
    if ([string]::IsNullOrWhiteSpace($text)) { return '002594.SZ' }
    return $text.Trim()
}

function Num {
    param([object]$Value)
    try { return [double]$Value } catch { return 0.0 }
}

function IntVal {
    param([object]$Value)
    try { return [int]$Value } catch { return 0 }
}

function Trade-Time {
    param([object]$RawValue)
    if ($null -eq $RawValue) { return '--' }
    $digits = -join (([string]$RawValue).ToCharArray() | Where-Object { $_ -match '[0-9]' })
    if ($digits.Length -lt 9) { return [string]$RawValue }
    $tail = $digits.Substring($digits.Length - 9)
    return '{0}:{1}:{2}.{3}' -f $tail.Substring(0, 2), $tail.Substring(2, 2), $tail.Substring(4, 2), $tail.Substring(6, 3)
}

function Trade-Side {
    param([object]$RawValue)
    if ($RawValue -eq 0 -or $RawValue -eq '0') { return 'BUY' }
    if ($RawValue -eq 1 -or $RawValue -eq '1') { return 'SELL' }
    return 'UNKNOWN'
}

function Build-OrderFlow {
    param([object]$Payload)

    $symbol = Normalize-Symbol $Payload.symbol
    $l2 = $Payload.l2
    $bids = @()
    $asks = @()
    $tape = @()

    if ($null -ne $l2 -and $null -ne $l2.topBid -and $null -ne $l2.topBid.price) {
        $bids += @{ price = Num $l2.topBid.price; volume = IntVal $l2.topBid.volume; orders = IntVal $l2.topBid.orders }
    }

    if ($null -ne $l2 -and $null -ne $l2.topAsk -and $null -ne $l2.topAsk.price) {
        $asks += @{ price = Num $l2.topAsk.price; volume = IntVal $l2.topAsk.volume; orders = IntVal $l2.topAsk.orders }
    }

    if ($null -ne $l2 -and $null -ne $l2.transactionSample -and $l2.transactionSample.Count -ge 3) {
        $sideValue = $null
        if ($l2.transactionSample.Count -gt 4) {
            $sideValue = $l2.transactionSample[4]
        }
        $tape += @{ time = Trade-Time $l2.transactionSample[0]; side = Trade-Side $sideValue; price = Num $l2.transactionSample[1]; volume = IntVal $l2.transactionSample[2] }
    }

    $capturedAt = ([datetimeoffset](Get-Date)).ToString('o')
    $l2Status = 'unknown'
    $l2Message = ''
    $outboundStatus = 'unknown'
    $accountStatus = 'unknown'
    $kind = ''
    $phase = ''
    $venue = 'stock'

    if ($Payload.kind) { $kind = [string]$Payload.kind }
    if ($Payload.phase) { $phase = [string]$Payload.phase }
    if ($Payload.businessType) { $venue = [string]$Payload.businessType }
    if ($null -ne $l2) {
        if ($l2.status) { $l2Status = [string]$l2.status }
        if ($l2.message) { $l2Message = [string]$l2.message }
    }
    if ($null -ne $Payload.outbound -and $Payload.outbound.status) { $outboundStatus = [string]$Payload.outbound.status }
    if ($null -ne $Payload.account -and $Payload.account.status) { $accountStatus = [string]$Payload.account.status }

    return @{
        symbol = $symbol
        capturedAt = $capturedAt
        source = 'ptrade-validation-relay'
        venue = $venue
        depthLevels = [Math]::Max($bids.Count, $asks.Count)
        bids = $bids
        asks = $asks
        tape = $tape
        spreadBps = 0.0
        imbalance = 0.0
        validation = @{
            kind = $kind
            phase = $phase
            l2Status = $l2Status
            l2Message = $l2Message
            outboundStatus = $outboundStatus
            accountStatus = $accountStatus
        }
    }
}

function Build-Health {
    $status = 'waiting_for_ingest'
    $message = 'waiting for ingest'
    if ($script:LastIngestAt) {
        $status = 'stale'
        $message = 'data received'
    }

    $lastKind = ''
    if ($script:LastPayload -and $script:LastPayload.kind) {
        $lastKind = [string]$script:LastPayload.kind
    }

    return @{
        mode = 'relay'
        status = $status
        transport = 'http-ingest'
        message = $message
        listen = @{
            host = '127.0.0.1'
            port = $Port
            ingestPath = '/ptrade'
            validationIngestPath = '/ptrade/validation'
        }
        windowsLoopbackUrl = Get-BaseUrl
        advertiseUrls = @((Get-BaseUrl))
        lastIngestAt = $script:LastIngestAt
        symbols = @($script:OrderFlows.Keys)
        lastKind = $lastKind
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

Write-Host "[ptrade-relay-win-ps] listening on $(Get-BaseUrl)"
Write-Host "[ptrade-relay-win-ps] target=$(Get-BaseUrl)/ptrade"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $path = $request.Url.AbsolutePath

        try {
            if ($request.HttpMethod -eq 'OPTIONS') {
                Send-Json -Context $context -StatusCode 204 -Payload @{}
                continue
            }

            if ($request.HttpMethod -eq 'GET' -and $path -eq '/health') {
                Send-Json -Context $context -StatusCode 200 -Payload (Build-Health)
                continue
            }

            if ($request.HttpMethod -eq 'GET' -and $path -eq '/payload/latest') {
                Send-Json -Context $context -StatusCode 200 -Payload @{ lastIngestAt = $script:LastIngestAt; lastPayload = $script:LastPayload }
                continue
            }

            if ($request.HttpMethod -eq 'GET' -and $path -eq '/l2-order-flow') {
                $query = [System.Web.HttpUtility]::ParseQueryString($request.Url.Query)
                $symbol = Normalize-Symbol $query.Get('symbol')
                if (-not $script:OrderFlows.ContainsKey($symbol)) {
                    Send-Json -Context $context -StatusCode 404 -Payload @{ error = 'No ptrade order-flow has been ingested yet'; symbol = $symbol }
                    continue
                }

                Send-Json -Context $context -StatusCode 200 -Payload $script:OrderFlows[$symbol]
                continue
            }

            if ($request.HttpMethod -eq 'POST' -and ($path -eq '/ptrade' -or $path -eq '/ptrade/validation')) {
                $rawBody = Read-Body $request
                $payload = $rawBody | ConvertFrom-Json
                $orderFlow = Build-OrderFlow $payload
                $symbol = Normalize-Symbol $orderFlow.symbol

                $script:LastIngestAt = ([datetimeoffset](Get-Date)).ToString('o')
                $script:LastPayload = $payload
                $script:OrderFlows[$symbol] = $orderFlow

                $l2Path = '/l2-order-flow?symbol=' + $symbol
                Send-Json -Context $context -StatusCode 202 -Payload @{
                    status = 'accepted'
                    symbol = $symbol
                    relayUrl = Get-BaseUrl
                    windowsLoopbackUrl = Get-BaseUrl
                    ingestPath = '/ptrade'
                    validationIngestPath = '/ptrade/validation'
                    healthPath = '/health'
                    l2Path = $l2Path
                    payloadPath = '/payload/latest'
                    lastIngestAt = $script:LastIngestAt
                }
                continue
            }

            Send-Json -Context $context -StatusCode 404 -Payload @{ error = 'Not found' }
        } catch {
            Send-Json -Context $context -StatusCode 500 -Payload @{ error = $_.Exception.Message }
        }
    }
} finally {
    $listener.Stop()
}