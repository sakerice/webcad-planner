import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

guard CommandLine.arguments.count >= 4 else {
    fputs("usage: encode_image_sequence <png-dir> <output.mp4> <fps>\n", stderr)
    exit(2)
}

let inputDir = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let fps = Int32(CommandLine.arguments[3]), fps > 0 else {
    fputs("fps must be a positive integer\n", stderr)
    exit(2)
}

let files = try FileManager.default
    .contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension.lowercased() == "png" }
    .sorted { $0.lastPathComponent < $1.lastPathComponent }

guard !files.isEmpty else {
    fputs("no png files in \(inputDir.path)\n", stderr)
    exit(1)
}

func loadImage(_ url: URL) -> CGImage? {
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

guard let first = loadImage(files[0]) else {
    fputs("failed to read \(files[0].lastPathComponent)\n", stderr)
    exit(1)
}
let width = first.width
let height = first.height

try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32ARGB),
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

func pixelBuffer(from image: CGImage) -> CVPixelBuffer? {
    guard let pool = adaptor.pixelBufferPool else { return nil }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard let buf = buffer else { return nil }
    CVPixelBufferLockBaseAddress(buf, [])
    defer { CVPixelBufferUnlockBaseAddress(buf, []) }
    guard let ctx = CGContext(
        data: CVPixelBufferGetBaseAddress(buf),
        width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buf),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { return nil }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buf
}

let queue = DispatchQueue(label: "pv.encode")
let done = DispatchSemaphore(value: 0)
var frameIndex = 0
var failure: String?

input.requestMediaDataWhenReady(on: queue) {
    while input.isReadyForMoreMediaData {
        if frameIndex >= files.count {
            input.markAsFinished()
            done.signal()
            return
        }
        let url = files[frameIndex]
        guard let image = loadImage(url), let buf = pixelBuffer(from: image) else {
            failure = "failed to encode \(url.lastPathComponent)"
            input.markAsFinished()
            done.signal()
            return
        }
        let time = CMTime(value: CMTimeValue(frameIndex), timescale: fps)
        if !adaptor.append(buf, withPresentationTime: time) {
            failure = "append failed at frame \(frameIndex)"
            input.markAsFinished()
            done.signal()
            return
        }
        frameIndex += 1
    }
}

done.wait()
if let failure {
    fputs(failure + "\n", stderr)
    exit(1)
}

let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()

if writer.status != .completed {
    fputs("writer failed: \(writer.error?.localizedDescription ?? "unknown")\n", stderr)
    exit(1)
}
print("wrote \(outputURL.path) — \(frameIndex) frames @ \(fps)fps, \(width)x\(height)")
