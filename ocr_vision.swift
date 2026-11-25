// Agent Office local OCR fallback (macOS Vision).
// Usage: swift ocr_vision.swift /absolute/path/to/image
import Foundation
import AppKit
import Vision

let args = CommandLine.arguments
if args.count < 2 {
    FileHandle.standardError.write("usage: ocr_vision.swift <image>\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
guard let image = NSImage(contentsOfFile: path) else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
    exit(3)
}
var rect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
    FileHandle.standardError.write("cannot decode image\n".data(using: .utf8)!)
    exit(4)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "en-US"]
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
    let observations = request.results ?? []
    for observation in observations {
        if let candidate = observation.topCandidates(1).first {
            print(candidate.string)
        }
    }
} catch {
    FileHandle.standardError.write(("vision failed: \(error)\n").data(using: .utf8)!)
    exit(5)
}
