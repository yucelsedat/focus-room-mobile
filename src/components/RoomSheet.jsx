// Oda gezinme sayfası — web RoomNavHUD'un (üst odalar / alt odalar / geçmiş)
// dikey ekran karşılığı, artı bağlantılı odalar.
// Her kart: Gir · Keşfet (alt odası varsa: sayfadan çıkmadan alt odalara iner) ·
// dişli → ayarlar: bağlantıyı sil / sadece bu odayı sil / kökleriyle birlikte sil.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useStore } from '../store/useStore'
import { api } from '../api/client'
import { deleteRoom, descendantIds, disconnectRooms, relationOf } from '../api/rooms'
import { getAncestors } from '../shared/roomTree'
import { Sheet, SectionLabel } from './Sheet'
import { RoomCard } from './RoomCard'
import { Icon } from './Icon'
import { colors, fonts, type, space, radius } from '../theme'

export function RoomSheet({ onGo }) {
  const visible = useStore((s) => s.roomSheet)
  const setRoomSheet = useStore((s) => s.setRoomSheet)
  const rooms = useStore((s) => s.rooms)
  const currentId = useStore((s) => s.currentRoomId)
  const currentName = useStore((s) => s.currentRoomName)
  const history = useStore((s) => s.roomHistory)
  const [linked, setLinked] = useState([])
  const [linksRev, setLinksRev] = useState(0)
  const [trail, setTrail] = useState([])       // Keşfet: inilen odalar [{ id, name }]
  const [settings, setSettings] = useState(null) // { room, partner, relation }

  useEffect(() => {
    if (!visible || !currentId) return
    let alive = true
    api(`/api/rooms/${encodeURIComponent(currentId)}/links`)
      .then((rows) => { if (alive) setLinked(rows) })
      .catch(() => { if (alive) setLinked([]) })
    return () => { alive = false }
  }, [visible, currentId, linksRev])

  const close = () => { setRoomSheet(false); setTrail([]); setSettings(null) }
  const go = (id, name) => { close(); onGo(id, name) }

  const byId = (id) => rooms.find((r) => r.id === id)
  const childCount = (id) => byId(id)?.children?.length ?? 0
  const here = { id: currentId, name: currentName }
  const linkedIds = linked.map((l) => l.id)

  // Kart: partner = bağlantı silmede karşı oda (liste kimin üzerinden geliyorsa)
  const card = (room, { hint, tone, partner = here } = {}) => (
    <RoomCard
      key={`${partner?.id}:${room.id}`}
      name={room.name}
      hint={hint}
      tone={tone}
      current={room.id === currentId}
      childCount={childCount(room.id)}
      onEnter={() => go(room.id, room.name)}
      onExplore={() => setTrail((t) => [...t, { id: room.id, name: byId(room.id)?.name ?? room.name }])}
      onSettings={() => setSettings({
        room: { id: room.id, name: byId(room.id)?.name ?? room.name },
        partner,
        relation: relationOf(rooms, partner?.id, room.id, partner?.id === currentId ? linkedIds : []),
      })}
    />
  )

  let eyebrow = 'Şu an buradasın'
  let title = currentName
  let body

  if (settings) {
    eyebrow = 'Oda ayarları'
    title = settings.room.name
    body = (
      <RoomSettings
        {...settings}
        rooms={rooms}
        currentId={currentId}
        onBack={() => setSettings(null)}
        onDisconnected={() => { setSettings(null); setLinksRev((v) => v + 1) }}
        onDeleted={({ deletedIds, currentDeleted, fallback }) => {
          if (currentDeleted) {
            close()
            if (fallback) onGo(fallback.id, fallback.name)
            else router.replace('/')
            return
          }
          setSettings(null)
          setLinksRev((v) => v + 1)
          // Keşfet yolunda silinen oda varsa ondan öncesine dön
          setTrail((t) => {
            const k = t.findIndex((r) => deletedIds.includes(r.id))
            return k < 0 ? t : t.slice(0, k)
          })
        }}
      />
    )
  } else if (trail.length) {
    const at = trail[trail.length - 1]
    const kids = byId(at.id)?.children ?? []
    eyebrow = 'Keşfet'
    title = at.name
    body = (
      <>
        <Pressable onPress={() => setTrail((t) => t.slice(0, -1))} style={styles.back} hitSlop={8} accessibilityRole="button">
          <Text style={styles.backText}>‹ {trail.length > 1 ? trail[trail.length - 2].name : 'Bulunduğun oda'}</Text>
        </Pressable>
        <Text style={styles.crumb} numberOfLines={1}>{[currentName, ...trail.map((r) => r.name)].join('  ›  ')}</Text>
        {card({ id: at.id, name: at.name }, { hint: 'Keşfettiğin oda', partner: trail.length > 1 ? trail[trail.length - 2] : here })}
        <SectionLabel>{`Alt odalar · ${kids.length}`}</SectionLabel>
        {kids.map((c) => card(c, { partner: at }))}
        {!kids.length && <Text style={styles.empty}>Bu odanın alt odası kalmadı.</Text>}
      </>
    )
  } else {
    const ancestors = getAncestors(rooms, currentId)
    const current = byId(currentId)
    const children = current?.children ?? []
    const recent = [...history].reverse().filter((r) => r.id !== currentId).slice(0, 8)
    const empty = !ancestors.length && !children.length && !linked.length && !recent.length
    body = (
      <>
        {ancestors.length > 0 && (
          <>
            <SectionLabel>Üst odalar</SectionLabel>
            {ancestors.map((a, i) => card(a, { hint: i === 0 ? 'Kök oda' : i === ancestors.length - 1 ? 'Üst oda' : undefined }))}
          </>
        )}
        {children.length > 0 && (
          <>
            <SectionLabel>Alt odalar</SectionLabel>
            {children.map((c) => card(c))}
          </>
        )}
        {linked.length > 0 && (
          <>
            <SectionLabel>Bağlantılı odalar</SectionLabel>
            {linked.map((l) => card(l, {
              tone: colors.link,
              hint: l.outgoing && l.incoming ? 'İki yönlü bağlantı' : l.outgoing ? 'Buradan bağlantı' : 'Buraya bağlantı',
            }))}
          </>
        )}
        {recent.length > 0 && (
          <>
            <SectionLabel>Son gezilenler</SectionLabel>
            {recent.map((r) => card(r, { tone: colors.faint }))}
          </>
        )}
        {empty && (
          <Text style={styles.empty}>
            Bu odanın bağlı olduğu başka oda yok. Duvardaki renkli kapılardan yürüyerek de geçebilirsin.
          </Text>
        )}
      </>
    )
  }

  return (
    <Sheet visible={visible} onClose={close} eyebrow={eyebrow} title={title}>
      {body}
    </Sheet>
  )
}

// --- Ayarlar: üç seçenek -------------------------------------------------------

function RoomSettings({ room, partner, relation, rooms, currentId, onBack, onDisconnected, onDeleted }) {
  const [busy, setBusy] = useState(null) // çalışan seçenek
  const desc = descendantIds(rooms, room.id)
  const isDefault = room.id === 'default'
  const isCurrent = room.id === currentId
  const currentInside = desc.includes(currentId)

  const linkText = {
    child: `“${room.name}” artık “${partner?.name}” odasının alt odası olmaz; aradaki kapılar kalkar.`,
    parent: `“${partner?.name}” artık “${room.name}” odasının alt odası olmaz; aradaki kapılar kalkar.`,
    link: `“${partner?.name}” ile aradaki bağlantı kapıları kalkar.`,
  }[relation] ?? `“${partner?.name ?? ''}” ile doğrudan bir bağı yok.`

  const run = (key, title, message, action, after) => Alert.alert(title, message, [
    { text: 'Vazgeç', style: 'cancel' },
    {
      text: key === 'link' ? 'Bağlantıyı sil' : 'Sil',
      style: 'destructive',
      onPress: async () => {
        setBusy(key)
        try {
          after(await action())
        } catch (err) {
          setBusy(null)
          Alert.alert('İşlem yapılamadı', err?.message ?? String(err))
        }
      },
    },
  ])

  const moveNote = isCurrent || currentInside ? '\n\nŞu an bu odadasın (ya da altındasın); silinince üst odaya geçilir.' : ''

  return (
    <View>
      <Pressable onPress={onBack} disabled={!!busy} style={styles.back} hitSlop={8} accessibilityRole="button">
        <Text style={styles.backText}>‹ Geri</Text>
      </Pressable>

      <Option
        icon="unlink"
        tone="#f59e0b"
        title="Bağlantıyı sil"
        text={`${linkText} İki oda da içeriğiyle kalır.`}
        disabled={!relation}
        busy={busy === 'link'}
        locked={!!busy}
        onPress={() => run('link', 'Bağlantı silinsin mi?', linkText,
          () => disconnectRooms(partner.id, room.id), onDisconnected)}
      />
      <Option
        icon="trash"
        tone={colors.danger}
        title="Sadece bu odayı sil"
        text={isDefault ? 'Varsayılan oda silinemez.'
          : `Oda ve içindeki her şey silinir.${desc.length ? ` Alt odaları (${childrenOf(rooms, room.id)}) kök oda olarak kalır.` : ''}`}
        disabled={isDefault}
        busy={busy === 'room'}
        locked={!!busy}
        onPress={() => run('room', `“${room.name}” silinsin mi?`, `Oda ve içindeki her şey kalıcı olarak silinir. Bu işlem geri alınamaz.${isCurrent ? moveNote : ''}`,
          () => deleteRoom(room.id), onDeleted)}
      />
      <Option
        icon="tree"
        tone={colors.danger}
        strong
        title="Kökleriyle birlikte sil"
        text={isDefault ? 'Varsayılan oda silinemez.'
          : desc.length ? `Oda ve altındaki ${desc.length} oda, içerikleriyle birlikte silinir.` : 'Alt odası yok — "Sadece bu odayı sil" ile aynı.'}
        disabled={isDefault || !desc.length}
        busy={busy === 'tree'}
        locked={!!busy}
        onPress={() => run('tree', `“${room.name}” ve ${desc.length} alt odası silinsin mi?`,
          `Toplam ${desc.length + 1} oda ve içindeki her şey kalıcı olarak silinir. Bu işlem geri alınamaz.${moveNote}`,
          () => deleteRoom(room.id, { cascade: true }), onDeleted)}
      />
    </View>
  )
}

const childrenOf = (rooms, id) => rooms.filter((r) => r.parent?.id === id).length

function Option({ icon, tone, title, text, disabled, busy, locked, strong, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || locked}
      style={({ pressed }) => [styles.option, strong && !disabled && { borderColor: 'rgba(248,113,113,0.45)' }, disabled && styles.optionOff, pressed && styles.optionPressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.optionIcon, { backgroundColor: disabled ? colors.line : `${tone}22` }]}>
        {busy ? <ActivityIndicator size="small" color={tone} /> : <Icon name={icon} size={20} color={disabled ? colors.faint : tone} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, { color: disabled ? colors.faint : tone }]}>{title}</Text>
        <Text style={styles.optionText}>{text}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  empty: { fontFamily: fonts.body, fontSize: type.body, color: colors.muted, marginTop: space.sm },
  back: { alignSelf: 'flex-start', paddingVertical: space.xs, marginBottom: space.sm },
  backText: { fontFamily: fonts.strong, fontSize: type.caption + 1, color: colors.accent },
  crumb: { fontFamily: fonts.mono, fontSize: type.micro, color: colors.faint, marginBottom: space.md },
  option: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.md, marginBottom: space.sm,
    borderRadius: radius.md, backgroundColor: colors.surfaceHi, borderWidth: 1, borderColor: colors.line,
  },
  optionOff: { opacity: 0.6 },
  optionPressed: { backgroundColor: colors.line },
  optionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontFamily: fonts.strong, fontSize: type.body },
  optionText: { fontFamily: fonts.body, fontSize: type.caption, color: colors.muted, marginTop: 3, lineHeight: type.caption * 1.45 },
})
