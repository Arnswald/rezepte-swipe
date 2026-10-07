import AppKit
// iOS-Symbol (dunkle Standard-Apps) aus einem Zeichen mit Transparenz (PNG oder SVG), ohne Freistellen
let a = CommandLine.arguments
guard let zeichen = NSImage(contentsOfFile: a[1]) else { print("Zeichen nicht lesbar"); exit(1) }
let G = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: G, pixelsHigh: G, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSGraphicsContext.current!.imageInterpolation = .high
let r = NSRect(x: 0, y: 0, width: G, height: G)
NSGradient(colors: [NSColor(srgbRed: 0.086, green: 0.082, blue: 0.098, alpha: 1), NSColor(srgbRed: 0.165, green: 0.157, blue: 0.188, alpha: 1)])!.draw(in: r, angle: 90)
NSGradient(colors: [NSColor(white: 1, alpha: 0.06), NSColor(white: 1, alpha: 0)])!.draw(in: NSRect(x: 0, y: G / 2, width: G, height: G / 2), angle: -90)
let b = Double(G) * Double(a[3])!
let s = NSShadow(); s.shadowColor = NSColor(white: 0, alpha: 0.45); s.shadowOffset = NSSize(width: 0, height: -10); s.shadowBlurRadius = 24; s.set()
zeichen.draw(in: NSRect(x: (Double(G) - b) / 2, y: (Double(G) - b) / 2, width: b, height: b), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
