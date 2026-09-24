Add-Type -AssemblyName System.Drawing
$iconDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
foreach ($size in @(192, 512)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#24594b'))
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font('Microsoft YaHei', ($size * 0.46), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectangle = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
    $graphics.DrawString('吃', $font, [System.Drawing.Brushes]::White, $rectangle, $format)
    $bitmap.Save((Join-Path $iconDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $format.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}
