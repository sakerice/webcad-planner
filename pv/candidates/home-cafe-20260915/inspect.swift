import Foundation
import AVFoundation
import AppKit
let paths = Array(CommandLine.arguments.dropFirst())
for (i,p) in paths.enumerated() {
 let a = AVURLAsset(url: URL(fileURLWithPath:p))
 let d = CMTimeGetSeconds(a.duration)
 print("VIDEO \(i+1) duration=\(d) audio=\(a.tracks(withMediaType:.audio).count)")
 let g = AVAssetImageGenerator(asset:a); g.appliesPreferredTrackTransform=true; g.maximumSize=CGSize(width:420,height:260)
 let canvas=NSImage(size:NSSize(width:1680,height:780)); canvas.lockFocus(); NSColor.darkGray.setFill(); NSRect(x:0,y:0,width:1680,height:780).fill()
 for n in 0..<12 { let t=d*Double(n)/12; if let cg=try? g.copyCGImage(at:CMTime(seconds:t,preferredTimescale:600),actualTime:nil) {let im=NSImage(cgImage:cg,size:.zero); let x=(n%4)*420; let y=520-(n/4)*260; im.draw(in:NSRect(x:x,y:y+20,width:420,height:240)); (String(format:"%.1fs",t) as NSString).draw(at:NSPoint(x:x+8,y:y+2),withAttributes:[.foregroundColor:NSColor.white])} }
 canvas.unlockFocus(); let b=NSBitmapImageRep(data:canvas.tiffRepresentation!)!; try! b.representation(using:.jpeg,properties:[.compressionFactor:0.8])!.write(to:URL(fileURLWithPath:"pv/candidates/home-cafe-20260915/contact-\(i+1).jpg"))
}
