package expo.modules.notepaste

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.MimeTypeMap
import androidx.core.os.bundleOf
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private const val PASTE_IMAGE_EVENT = "onPasteImage"
private val IMAGE_MIME_TYPES = arrayOf("image/*")
private val TAG = NotePasteModule::class.java.simpleName

// React Native "Yapıştır"ı düz yazıya çevirdiği için panodaki resim normalde kaybolur.
// Bağlanan yazı alanında resim içeriği yazıya dönüşmeden yakalanır, dosyaya kaydedilir ve JS'e bildirilir.
class NotePasteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotePaste")

    Events(PASTE_IMAGE_EVENT)

    AsyncFunction("enable") { viewTag: Int ->
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction false
      ViewCompat.setOnReceiveContentListener(view, IMAGE_MIME_TYPES, receiver)
      return@AsyncFunction true
    }.runOnQueue(Queues.MAIN)
  }

  private val receiver = OnReceiveContentListener { view, payload ->
    val split = payload.partition { item -> item.uri != null }
    val withUri = split.first ?: return@OnReceiveContentListener payload

    val images = mutableListOf<Bundle>()
    val clip = withUri.clip
    for (i in 0 until clip.itemCount) {
      val uri = clip.getItemAt(i).uri ?: continue
      val mime = view.context.contentResolver.getType(uri) ?: clip.description.getMimeType(0)
      if (mime?.startsWith("image/") != true) continue
      saveImage(view.context, uri, mime)?.let(images::add)
    }
    if (images.isEmpty()) return@OnReceiveContentListener payload

    images.forEach { sendEvent(PASTE_IMAGE_EVENT, it) }
    // Panodan resim geldiyse yanındaki yazı (ör. resmin adresi) ayrıca yapıştırılmaz
    if (payload.source == ContentInfoCompat.SOURCE_CLIPBOARD) null else split.second
  }

  // İçerik izni yalnızca bu çağrı süresince geçerli olabileceği için dosya hemen kopyalanır
  private fun saveImage(context: Context, uri: Uri, mime: String): Bundle? {
    return try {
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: "jpg"
      val dir = File(context.cacheDir, "pasted-images").apply { mkdirs() }
      val file = File(dir, "paste-${System.nanoTime()}.$ext")
      val input = context.contentResolver.openInputStream(uri) ?: return null
      input.use { source -> file.outputStream().use { source.copyTo(it) } }

      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(file.path, bounds)
      bundleOf(
        "uri" to Uri.fromFile(file).toString(),
        "mimeType" to mime,
        "width" to bounds.outWidth,
        "height" to bounds.outHeight
      )
    } catch (e: Exception) {
      Log.w(TAG, "Pasted image could not be read", e)
      null
    }
  }
}
