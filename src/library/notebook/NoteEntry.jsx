import { useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'

import { leadingHeadingCenter } from '../components/MarkdownView'
import { BlockGrip, DOC_ROW_LEFT, DOC_ROW_RIGHT, useDocumentMode } from './DocumentMode'
import { DOC_RENDERED_PAD } from './DocTextSegment'
import { DragHandle, useDraggedStyle } from './DragReorder'
import { NoteFile } from './NoteFile'
import { NoteImage } from './NoteImage'
import { MarginTime, NoteTextSegment } from './NoteTextSegment'

import { deleteAttachmentFile, openAttachment } from '../lib/attachments'
import { flowAround, imageRect, intersects, layoutBlockImages } from '../lib/imageLayout'
import { marksIn, parseMarks } from '../lib/marks'
import { parseContent, removeAttachment, serializeContent } from '../lib/noteContent'
import { docPage, handTailWidth, notebook } from '../theme'

// Notun satırları kenar boşluğundan ROW_LEFT kadar içeride başlar, sağda ROW_RIGHT pay kalır
export const ROW_LEFT = notebook.marginX + 12
export const ROW_RIGHT = 20

export function confirmRemoveAttachment(attachment, onRemove) {
  const what = attachment.type === 'image' ? 'Bu resim' : `"${attachment.label}"`
  Alert.alert('Eki sil', `${what} sayfadan kaldırılsın mı?`, [
    { text: 'Vazgeç', style: 'cancel' },
    {
      text: 'Sil',
      style: 'destructive',
      onPress: () => {
        onRemove()
        deleteAttachmentFile(attachment.name)
      },
    },
  ])
}

// Kenar boşluğunda saat; satırların üzerinde el yazısı, resimler ve dosya ekleri
export function NoteEntry({
  note,
  focusRequest,
  onChangeContent,
  onActive,
  onBlur,
  readOnly = false,
  editingImage,
  onEditImage,
  onOpenImage,
  onImageAnchor,
  onTouchImage,
  highlighter,
  onSelect,
  reorder,
  index,
  lifted,
  onLayout,
  onMoveLine,
  onLineDragChange,
  onSplit,
  onMergeBack,
  inert = false,
  selected = false,
}) {
  const segments = parseContent(note.content)
  const highlights = parseMarks(note.highlights)
  const inks = parseMarks(note.inks)
  const times = parseMarks(note.times)
  // Kenar boşluğunda bloğun saati; saat konmamışsa ama blok kutulu bir satırla başlıyorsa o
  // satırın saati, o da yoksa çizgi
  const time = note.time ?? times.find((m) => m.start === 0)?.color ?? null
  // Her bölümün içerikteki başlangıcı; boya ve yazı renkleri yazı bölümlerine bu konumlarla dağıtılır
  const starts = []
  segments.reduce((offset, segment) => {
    starts.push(offset)
    return offset + serializeContent([segment]).length
  }, 0)
  const inputs = useRef(new Map())
  const cursors = useRef(new Map())
  // Odaktaki yazı bölümü. Odaktaki not öne alınır ki seçim tutamaçları alttaki notların üstünde kalsın
  const [focusedSegment, setFocusedSegment] = useState(null)
  const focused = focusedSegment !== null
  // Satırı sürüklenen not da öne alınır; satır kendi notunun üstünde yürür
  const [lineDragging, setLineDragging] = useState(false)
  const draggedStyle = useDraggedStyle(reorder, index)
  // Bölümlerin notun içindeki yerleri (bölümün anahtarıyla), resim yüzünden itilmeden önceki
  // hâliyle: itilen bölüm kendi itilmesini ölçüp "artık değmiyorum" sanmasın
  const [boxes, setBoxes] = useState({})
  // Resimlerin içerikteki yerleri (önlerindeki yazının altı) ve bloğun boyu, yazı genişliği
  const [anchors, setAnchors] = useState({})
  const [size, setSize] = useState({ width: 0, height: 0 })
  // PDF'te satırlar beyaz kâğıdın içinde, kenar boşluğunda saat yerine tutamaç durur
  const document = useDocumentMode()
  const rowLeft = document ? DOC_ROW_LEFT : ROW_LEFT
  const rowRight = document ? DOC_ROW_RIGHT : ROW_RIGHT
  const textWidth = Math.max(0, size.width - rowLeft - rowRight)

  // Resimler bloğun içinde yüzer; blok en alttaki resmin altına kadar uzar. Blok saatinden
  // sürüklenince resimler de onunla gider.
  const images = layoutBlockImages(
    segments.flatMap((s, i) =>
      s.type === 'image' ? [{ index: i, image: s, anchorTop: anchors[s.name] }] : [],
    ),
    textWidth,
  )
  const imagesBottom = Math.max(0, ...images.map((f) => f.bottom))

  function anchored(name, top) {
    setAnchors((prev) => (prev[name] === top ? prev : { ...prev, [name]: top }))
  }

  function placed(key, e, push = 0) {
    const top = e.nativeEvent.layout.y - push
    const { height } = e.nativeEvent.layout
    setBoxes((prev) => {
      const old = prev[key]
      return old && old.top === top && old.height === height ? prev : { ...prev, [key]: { top, height } }
    })
  }

  // Bölüm değdiği resmin olmadığı tarafa çekilir ya da resmin altına itilir
  function flowOf(key) {
    const box = boxes[key]
    return box ? flowAround(images, box.top, box.height, textWidth) : { push: 0, indent: undefined }
  }

  // PDF'te blok bir başlıkla başlıyorsa tutamacın çizgisi o başlığın satırına ortalanır. Ham
  // Markdown yazılırken başlık düz satır olduğu için kaydırma yoktur; biçimli yazarken başlık
  // yazılırken de başlıktır.
  const first = segments[0]
  const firstText = document && first?.type === 'text' ? first.text : ''
  const headingCenter = firstText ? leadingHeadingCenter(firstText) : null
  const gripOffset =
    headingCenter !== null && (!document?.rawMarkdown || focusedSegment !== 0)
      ? Math.max(
          0,
          Math.round(flowOf('t-0').push + DOC_RENDERED_PAD + headingCenter - docPage.lineHeight / 2),
        )
      : 0

  // İki ek arasında kalan boş yazı bölümü, ardındaki resim elle yerleştirildiyse (ör. yanındaki
  // resmin yanına konduysa) yer kaplamaz: o resim artık bölümün altına bağlı değildir, bölüm de
  // resimlerin altına itilip bloğun sonunda silinemeyen fazladan bir satır bırakırdı. Odaklanınca
  // (ya da içine yazı girince) yine görünür.
  function collapsedAt(i) {
    const segment = segments[i]
    const next = segments[i + 1]
    return (
      i > 0 &&
      segment.type === 'text' &&
      segment.text === '' &&
      next?.type === 'image' &&
      next.row !== undefined &&
      focusedSegment !== i
    )
  }

  function flowStyle(flow) {
    return {
      marginTop: flow.push,
      marginLeft: flow.indent?.left ?? 0,
      marginRight: flow.indent?.right ?? 0,
    }
  }

  // Yeni not açılınca ya da ek eklenince istenen yazı bölümüne odaklan
  useEffect(() => {
    if (focusRequest?.noteId === note.id) {
      const input = inputs.current.get(focusRequest.segment)
      input?.focus()
      if (focusRequest.cursor !== undefined) {
        input?.setSelection(focusRequest.cursor, focusRequest.end ?? focusRequest.cursor)
      }
    }
  }, [focusRequest, note.id])

  function commit(next) {
    onChangeContent(serializeContent(next))
  }

  function changeText(index, text) {
    commit(segments.map((s, i) => (i === index ? { type: 'text', text } : s)))
  }

  function confirmRemove(index) {
    const segment = segments[index]
    if (segment.type === 'text') return
    confirmRemoveAttachment(segment, () => commit(removeAttachment(segments, index)))
  }

  function changeImages(changes) {
    commit(segments.map((s, i) => changes.get(i) ?? s))
  }

  // Resim bloğun içinde bırakıldı. Boş yere bırakılırsa oraya yerleşir; başka bir resmin üstüne
  // (ortası o resmin üstüne gelecek kadar) bırakılırsa ikisi yer değiştirir; başka bir resme yalnızca
  // değiyorsa yerine geri döner.
  function dropImage(moved, x, row) {
    const rect = imageRect(moved.image, row, x, textWidth)
    const hits = images.filter((f) => f.index !== moved.index && intersects(f, rect))
    if (hits.length === 0) {
      changeImages(new Map([[moved.index, { ...moved.image, x, row }]]))
      return
    }
    const cx = (rect.x0 + rect.x1) / 2
    const cy = (rect.top + rect.bottom) / 2
    const target = hits.find((f) => cx >= f.x0 && cx <= f.x1 && cy >= f.top && cy <= f.bottom)
    if (!target) return
    changeImages(
      new Map([
        [moved.index, { ...moved.image, x: target.image.x, row: target.row }],
        [target.index, { ...target.image, x: moved.image.x, row: moved.row }],
      ]),
    )
  }

  // Resim bloğunun dışına çıkamaz: en üst satırla bloğun en alt satırı arasında kayar
  function rowsOf(f) {
    const lines = Math.floor((Math.max(size.height, f.bottom) + 1) / notebook.lineHeight)
    return { current: f.row, min: 0, max: Math.max(f.row, lines - f.image.lines) }
  }

  return (
    // collapsable={false}: zIndex açılıp kapanınca görünüm yeniden kurulmasın, yoksa yazı alanı odağı kaybeder
    <Animated.View
      collapsable={false}
      pointerEvents={inert ? 'none' : 'auto'}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
        onLayout(e)
      }}
      style={[
        styles.row,
        { minHeight: imagesBottom, paddingLeft: rowLeft, paddingRight: rowRight },
        (focused || lineDragging) && styles.raised,
        lifted && styles.lifted,
        lifted && document && styles.liftedDocument,
        draggedStyle,
      ]}
    >
      {selected && <View pointerEvents="none" style={styles.selected} />}
      {/* Saat ya da çizgi bloğun tutamacıdır: basılı tutup yukarı aşağı sürükleyince blok yer değiştirir */}
      <DragHandle reorder={reorder} index={index} enabled={!readOnly} hitSlop={8} style={styles.timeHandle}>
        {document ? <BlockGrip offset={gripOffset} /> : <MarginTime time={time} />}
      </DragHandle>
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'text': {
            const key = `t-${i}`
            const collapsed = collapsedAt(i)
            const flow = collapsed ? { push: 0, indent: undefined } : flowOf(key)
            return (
              <NoteTextSegment
                key={key}
                onLayout={(e) => placed(key, e, flow.push)}
                indent={flow.indent}
                push={flow.push}
                collapsed={collapsed}
                ref={(el) => {
                  if (el) inputs.current.set(i, el)
                  else inputs.current.delete(i)
                }}
                value={segment.text}
                readOnly={readOnly}
                placeholder={segments.length === 1 && !readOnly ? 'Yaz…' : undefined}
                onChangeText={(text) => changeText(i, text)}
                onSelectionChange={(cursor) => {
                  cursors.current.set(i, cursor)
                  onActive(i, cursor)
                }}
                onFocus={() => {
                  setFocusedSegment(i)
                  onActive(i, cursors.current.get(i) ?? segment.text.length)
                }}
                onBlur={() => {
                  // Odak bloğun başka bölümüne geçerken onun odağı önce gelmiş olabilir
                  setFocusedSegment((prev) => (prev === i ? null : prev))
                  onBlur()
                }}
                highlights={marksIn(highlights, starts[i], starts[i] + segment.text.length)}
                inks={marksIn(inks, starts[i], starts[i] + segment.text.length)}
                times={marksIn(times, starts[i], starts[i] + segment.text.length)}
                firstInNote={i === 0}
                onEnter={(at, prefix) => onSplit(i, at, prefix)}
                onBackspaceAtStart={i === 0 ? onMergeBack : undefined}
                highlighter={readOnly ? null : highlighter}
                onSelect={(start, end) => onSelect(starts[i] + start, starts[i] + end)}
                onMoveLine={(from, to) => onMoveLine(i, from, to)}
                onDragChange={(dragging) => {
                  setLineDragging(dragging)
                  onLineDragChange(dragging)
                }}
              />
            )
          }
          case 'image':
            // Resmin içerikteki yerinde yalnızca yerini bildiren boş bir işaret kalır; resmin
            // kendisi bloğun üstüne çizilir
            return (
              <View
                key={`i-${segment.name}`}
                onLayout={(e) => anchored(segment.name, e.nativeEvent.layout.y)}
              />
            )
          case 'file': {
            const key = `f-${segment.name}`
            const flow = flowOf(key)
            return (
              <View key={key} onLayout={(e) => placed(key, e, flow.push)} style={flowStyle(flow)}>
                <NoteFile
                  file={segment}
                  onPress={() => openAttachment(segment.name)}
                  onLongPress={readOnly ? undefined : () => confirmRemove(i)}
                />
              </View>
            )
          }
        }
      })}

      {images.map((f) => (
        <View
          key={`p-${f.image.name}`}
          pointerEvents="box-none"
          style={[styles.image, { top: f.top, left: rowLeft, width: textWidth }]}
        >
          <NoteImage
            image={f.image}
            readOnly={readOnly}
            editing={editingImage === f.image.name}
            onPress={() => onEditImage(editingImage === f.image.name ? null : f.image.name)}
            onLongPress={() => confirmRemove(f.index)}
            onChange={(next) => changeImages(new Map([[f.index, next]]))}
            rows={rowsOf(f)}
            onMove={(x, row) => dropImage(f, x, row)}
            onTouch={onTouchImage}
            onOpen={(origin) => onOpenImage(f.image.name, origin)}
            onAnchor={(node) => onImageAnchor(f.image.name, node)}
          />
        </View>
      ))}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  row: {
    paddingLeft: ROW_LEFT,
    paddingRight: ROW_RIGHT,
  },
  raised: {
    zIndex: 10,
  },
  // Seçili blok: satırların ve yazının altında, bloğu baştan sona saran hafif mavi
  selected: {
    position: 'absolute',
    top: 1,
    bottom: 1,
    left: 4,
    right: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: notebook.selectionEdge,
    backgroundColor: notebook.selectionTint,
  },
  // Resim bloğun yazılarının üstünde durur; seçim tutamaçları da onu örtmez
  image: {
    position: 'absolute',
    left: ROW_LEFT,
    zIndex: 15,
  },
  liftedDocument: {
    backgroundColor: docPage.sheet,
  },
  // Sürüklenen not kâğıttan kaldırılmış gibi: altındaki satırları örter, gölgesi düşer
  lifted: {
    zIndex: 20,
    backgroundColor: notebook.paper,
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  // Sağa dayalı saatin sonundaki boşluk kadar kutu geniş tutulur; rakamlar yine aynı yerde biter
  timeHandle: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: notebook.marginX - 8 + handTailWidth(15),
    zIndex: 1,
  },
})
