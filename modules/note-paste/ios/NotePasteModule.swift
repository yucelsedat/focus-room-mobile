import ExpoModulesCore
import ObjectiveC
import UIKit
import UniformTypeIdentifiers

private let pasteImageEvent = "onPasteImage"

// iOS, panoda yalnızca resim varken çok satırlı yazı alanında "Yapıştır"ı göstermez.
// React Native'in yazı alanı sınıfına (RCTUITextView) küçük bir kanca takılır:
// panoda resim varsa "Yapıştır" görünür, basılınca resim dosyaya kaydedilip JS'e bildirilir.
public class NotePasteModule: Module {
  // Yalnızca ana iş parçacığında (menü ve modül kurulumu) okunup yazılır
  nonisolated(unsafe) fileprivate static weak var current: NotePasteModule?

  public func definition() -> ModuleDefinition {
    Name("NotePaste")

    Events(pasteImageEvent)

    OnCreate {
      NotePasteModule.current = self
      PasteHook.install()
    }

    // Android'de her yazı alanı tek tek bağlanır; iOS'ta kanca bütün çok satırlı alanlarda zaten çalışır
    AsyncFunction("enable") { (_: Int) -> Bool in
      return true
    }
  }

  fileprivate func emit(_ image: [String: Any]) {
    sendEvent(pasteImageEvent, image)
  }
}

private enum PasteHook {
  nonisolated(unsafe) static var installed = false

  static func install() {
    guard !installed, let cls = NSClassFromString("RCTUITextView") else { return }
    installed = true

    let pasteAction = #selector(UIResponderStandardEditActions.paste(_:))

    let canPerform = #selector(UIResponder.canPerformAction(_:withSender:))
    typealias CanPerformFn = @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
    if let original = class_getMethodImplementation(cls, canPerform) {
      let originalFn = unsafeBitCast(original, to: CanPerformFn.self)
      let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = { view, action, sender in
        if action == pasteAction, UIPasteboard.general.hasImages, (view as? UITextView)?.isEditable == true {
          return true
        }
        return originalFn(view, canPerform, action, sender)
      }
      replace(cls, canPerform, with: imp_implementationWithBlock(block))
    }

    typealias PasteFn = @convention(c) (AnyObject, Selector, Any?) -> Void
    if let original = class_getMethodImplementation(cls, pasteAction) {
      let originalFn = unsafeBitCast(original, to: PasteFn.self)
      let block: @convention(block) (AnyObject, Any?) -> Void = { view, sender in
        if UIPasteboard.general.hasImages, let module = NotePasteModule.current, let image = savePasteboardImage() {
          module.emit(image)
          return
        }
        originalFn(view, pasteAction, sender)
      }
      replace(cls, pasteAction, with: imp_implementationWithBlock(block))
    }
  }

  // Yalnızca bu sınıfın metodu değişir; tanımlı değilse üst sınıfınkini çağıran bir kopya eklenir
  private static func replace(_ cls: AnyClass, _ selector: Selector, with imp: IMP) {
    guard let method = class_getInstanceMethod(cls, selector) else { return }
    class_replaceMethod(cls, selector, imp, method_getTypeEncoding(method))
  }

  // Asıl dosya biçimi (GIF, PNG...) korunur; yoksa resim JPEG olarak kaydedilir
  private static func savePasteboardImage() -> [String: Any]? {
    let pasteboard = UIPasteboard.general
    let formats: [(UTType, String)] = [(.gif, "gif"), (.png, "png"), (.jpeg, "jpg"), (.heic, "heic")]

    var data: Data?
    var ext = "jpg"
    var mimeType = "image/jpeg"
    for (type, typeExt) in formats {
      if let typeData = pasteboard.data(forPasteboardType: type.identifier) {
        data = typeData
        ext = typeExt
        mimeType = type.preferredMIMEType ?? mimeType
        break
      }
    }
    if data == nil {
      data = pasteboard.image?.jpegData(compressionQuality: 0.85)
    }
    guard let data, let image = UIImage(data: data) else { return nil }

    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("pasted-images", isDirectory: true)
    let url = dir.appendingPathComponent("paste-\(UUID().uuidString).\(ext)")
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try data.write(to: url)
    } catch {
      return nil
    }

    return [
      "uri": url.absoluteString,
      "mimeType": mimeType,
      "width": image.size.width * image.scale,
      "height": image.size.height * image.scale,
    ]
  }
}
