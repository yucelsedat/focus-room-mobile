import Ionicons from '@expo/vector-icons/Ionicons'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Circle, Line, Rect } from 'react-native-svg'

import { BookCover, coverTitleStyle } from './BookCover'
import { CategoryManager } from './CategoryManager'
import { FIRST_PAGE_COUNT, GENERAL_CATEGORY_ID, getCategories } from '../db'
import { DEFAULT_DOCUMENT_PAPER, DOCUMENT_PAPERS } from '../lib/documentPaper'
import { FIRST_YEAR, LAST_YEAR, layoutOf } from '../lib/notebookLayout'
import { bookColorOf, bookColors, colors, DEFAULT_BOOK_COLOR, fonts, notebook, shelf, type } from '../theme'

const MAX_TITLE = 40

export function goBackToLibrary() {
  if (router.canGoBack()) router.back()
  else router.replace('/')
}

const STEP_NAMES = {
  kind: 'Tür',
  cover: 'Kapak',
  pages: 'Sayfalar',
}

// İlk etapta yalnızca PDF açılır; ajanda ve not defteri sonraki fazlarda (web'deki all-books ile
// aynı: focus-room-main/ALL-BOOKS-PLAN.md)
const KINDS = [
  {
    value: 'agenda',
    name: 'Ajanda',
    caption: 'Lastikli; günlere, haftalara ve aylara bölünmüş, tek yıllık',
    sample: 'Ajanda',
    soon: true,
  },
  {
    value: 'notes',
    name: 'Not defteri',
    caption: 'Telli; numaralı sayfalar, takvimden bağımsız',
    sample: 'Notlar',
    soon: true,
  },
  {
    value: 'pdf',
    name: 'PDF',
    caption: 'Dosya; A4 sayfalar, basılı yazı, biçimli metin yapıştırma',
    sample: 'Belge',
  },
]

const PAPERS = [
  { value: 'ruled', name: 'Çizgili' },
  { value: 'oxford', name: 'Oxford' },
  { value: 'plain', name: 'Düz' },
  { value: 'grid', name: 'Kareli' },
  { value: 'dot', name: 'Noktalı' },
]

const HABITS = [
  { value: 'none', name: 'Yok', caption: 'Alışkanlık sayfası eklenmez' },
  { value: 'month', name: 'Aylık', caption: 'Her ayın başında, ayın bütün günleri tek sayfada' },
  { value: 'week', name: 'Haftalık', caption: 'Her haftanın başında, yedi gün tek sayfada' },
]

// Türün cildi ve önerilen kâğıdı. Cilt türe bağlıdır: ajanda lastikli, not defteri telli, PDF bir
// belge dosyası. Kâğıt not defterinde sonradan seçilir (önerilen çizgili), PDF'te sayfa boyutu
// seçilir (önerilen A4), ajandada oxford kalır.
const KIND_DEFAULTS = {
  agenda: { binding: 'band', paper: 'oxford' },
  notes: { binding: 'spiral', paper: 'ruled' },
  pdf: { binding: 'file', paper: DEFAULT_DOCUMENT_PAPER },
}

export function defaultSettings() {
  return {
    title: '',
    color: DEFAULT_BOOK_COLOR,
    kind: 'pdf',
    ...KIND_DEFAULTS.pdf,
    year: new Date().getFullYear(),
    weekly_pages: 1,
    month_goals: 1,
    month_review: 1,
    habits: 'none',
    category_id: GENERAL_CATEGORY_ID,
  }
}

// Defter oluşturma ve düzenleme. Oluştururken önce tür (lastikli ajanda / telli not defteri), sonra
// kapak (kapağın etiketine yazılan ad, renk ve kitaplıkta duracağı kategori), en son sayfalar
// seçilir: not defterinde kâğıt, ajandada yıl ve sayfa düzeni. Düzenlerken tür ve ajandanın sayfa
// düzeni değişmez.
export function NotebookForm({ mode, initial, onSubmit }) {
  const insets = useSafeAreaInsets()
  const [settings, setSettings] = useState(() => initial ?? defaultSettings())
  const [categories, setCategories] = useState([])
  const [managing, setManaging] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCategories().then((list) => {
      if (!cancelled) setCategories(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Kâğıtta yeni kategori eklenince o seçilir; seçili kategori silinince Genel'e dönülür
  function categoriesChanged(list) {
    const added = list.filter((c) => !categories.some((old) => old.id === c.id))
    setCategories(list)
    if (added.length > 0) change({ category_id: added[added.length - 1].id })
    else if (!list.some((c) => c.id === settings.category_id)) {
      change({ category_id: GENERAL_CATEGORY_ID })
    }
  }
  const steps =
    mode === 'create'
      ? ['kind', 'cover', 'pages']
      : settings.kind !== 'agenda'
        ? ['cover', 'pages']
        : ['cover']
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex]
  const last = stepIndex === steps.length - 1
  const [saving, setSaving] = useState(false)
  const name = settings.title.trim()
  // Ad yazılmadan kapaktan ileri geçilmez
  const canContinue = (step !== 'cover' || name !== '') && (!last || name !== '') && !saving

  function change(patch) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function chooseKind(kind) {
    if (kind !== settings.kind) change({ kind, ...KIND_DEFAULTS[kind] })
  }

  function back() {
    if (stepIndex > 0) setStepIndex(stepIndex - 1)
    else goBackToLibrary()
  }

  async function next() {
    if (!canContinue) return
    if (!last) {
      setStepIndex(stepIndex + 1)
      return
    }
    setSaving(true)
    try {
      await onSubmit({
        ...settings,
        title: name,
        binding: KIND_DEFAULTS[settings.kind].binding,
        // PDF'in yılı yoktur; kapağında yıl yazmaz
        year: settings.kind === 'pdf' ? null : settings.year,
      })
      // Kitaplık odaklanınca defterleri yeniden okur, değişiklik rafta görünür
      goBackToLibrary()
    } catch (err) {
      // Defterler sunucuda durur; kaydedilemezse nedeni söylenir, form açık kalır
      Alert.alert('Kaydedilemedi', err?.message ?? 'Sunucuya ulaşılamadı')
      setSaving(false)
    }
  }

  // Android'in geri tuşu da bir önceki adıma döner
  useEffect(() => {
    if (stepIndex === 0) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setStepIndex((i) => Math.max(0, i - 1))
      return true
    })
    return () => sub.remove()
  }, [stepIndex])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel={stepIndex > 0 ? 'Önceki adım' : 'Kitaplığa dön'}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
        >
          <Ionicons name="arrow-back" size={24} color={colors.onInk} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{mode === 'create' ? 'Yeni defter' : 'Defteri düzenle'}</Text>
          {steps.length > 1 && (
            <Text style={styles.stepText}>{`${stepIndex + 1} / ${steps.length} · ${STEP_NAMES[step]}`}</Text>
          )}
        </View>
        <View style={styles.back} />
      </View>

      <KeyboardAvoidingView style={styles.body} behavior="padding">
        {/* Klavye açıkken içerik sığmazsa kaydırılır; seçeneklere dokunmak klavyeyi kapatmaz */}
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'kind' && <KindStep settings={settings} onChoose={chooseKind} />}
          {step === 'cover' && (
            <CoverStep
              settings={settings}
              categories={categories}
              onChange={change}
              onSubmit={next}
              onManageCategories={() => setManaging(true)}
            />
          )}
          {step === 'pages' &&
            (settings.kind === 'notes' ? (
              <PaperStep settings={settings} onChange={change} />
            ) : settings.kind === 'pdf' ? (
              <DocumentPaperStep settings={settings} onChange={change} />
            ) : (
              <AgendaStep settings={settings} onChange={change} />
            ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          {stepIndex > 0 && (
            <Pressable
              onPress={back}
              accessibilityRole="button"
              style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.buttonText}>Geri</Text>
            </Pressable>
          )}
          <Pressable
            onPress={next}
            disabled={!canContinue}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canContinue }}
            style={({ pressed }) => [
              styles.button,
              styles.primary,
              pressed && styles.pressed,
              !canContinue && styles.disabled,
            ]}
          >
            <Text style={styles.buttonText}>
              {last ? (mode === 'create' ? 'Oluştur' : 'Kaydet') : 'İleri'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <CategoryManager visible={managing} onClose={() => setManaging(false)} onChange={categoriesChanged} />
    </SafeAreaView>
  )
}

function Section({ title, caption, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {caption && <Text style={styles.caption}>{caption}</Text>}
      {children}
    </View>
  )
}

// 1. adım: ajanda mı, not defteri mi, PDF mi; her seçeneğin yanında o türün önerilen kapağı
function KindStep({ settings, onChoose }) {
  const { width } = useWindowDimensions()
  const cardWidth = (Math.min(width, 480) - 24 * 2 - 12) / 2
  const cover = bookColorOf(settings.color)

  return (
    <Section title="Ne tür bir defter?" caption="Türü sonradan değiştirilemez">
      <View style={styles.kindRow} accessibilityRole="radiogroup">
        {KINDS.map((kind) => {
          const selected = kind.value === settings.kind
          return (
            <Pressable
              key={kind.value}
              onPress={() => !kind.soon && onChoose(kind.value)}
              disabled={kind.soon}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: !!kind.soon }}
              accessibilityLabel={`${kind.name}. ${kind.caption}${kind.soon ? ' (yakında)' : ''}`}
              style={({ pressed }) => [
                styles.kindCard,
                { width: cardWidth },
                selected && styles.cardSelected,
                kind.soon && styles.cardSoon,
                pressed && styles.pressed,
              ]}
            >
              {kind.soon && <Text style={styles.soonTag}>yakında</Text>}
              <View style={styles.kindCover}>
                <BookCover
                  width={cardWidth * 0.56}
                  title={kind.sample}
                  color={cover.cover}
                  band={cover.band}
                  binding={KIND_DEFAULTS[kind.value].binding}
                  subtitle={kind.value === 'agenda' ? String(settings.year) : undefined}
                />
              </View>
              <Text style={styles.cardName}>{kind.name}</Text>
              <Text style={styles.cardCaption}>{kind.caption}</Text>
            </Pressable>
          )
        })}
      </View>
    </Section>
  )
}

// 2. adım: kapağın önizlemesindeki etikete yazılan ad, altından seçilen renk ve kitaplıkta
// duracağı kategori; cilt türden gelir
function CoverStep({ settings, categories, onChange, onSubmit, onManageCategories }) {
  const { width } = useWindowDimensions()
  const coverWidth = Math.min(width * 0.56, 230)
  const cover = bookColorOf(settings.color)

  return (
    <View style={styles.coverStep}>
      <BookCover
        width={coverWidth}
        color={cover.cover}
        band={cover.band}
        binding={KIND_DEFAULTS[settings.kind].binding}
        subtitle={settings.kind === 'agenda' && settings.year ? String(settings.year) : undefined}
      >
        <TextInput
          value={settings.title}
          onChangeText={(title) => onChange({ title })}
          placeholder="Defter adı"
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel="Defter adı"
          autoFocus={settings.title === ''}
          multiline
          maxLength={MAX_TITLE}
          // Enter yeni satır açmaz, sonraki adıma geçer
          submitBehavior="blurAndSubmit"
          returnKeyType="next"
          onSubmitEditing={onSubmit}
          style={[coverTitleStyle(coverWidth), styles.input]}
        />
      </BookCover>
      <Text style={styles.hint}>Adı kapağın üstüne yaz</Text>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Kapak rengi">
        {Object.keys(bookColors).map((key) => (
          <Swatch
            key={key}
            name={bookColors[key].name}
            cover={bookColors[key].cover}
            band={bookColors[key].band}
            binding={KIND_DEFAULTS[settings.kind].binding}
            selected={key === settings.color}
            onPress={() => onChange({ color: key })}
          />
        ))}
      </View>
      {categories.length > 0 && (
        <View style={styles.categoryBlock}>
          <Text style={styles.categoryLabel}>Kitaplıkta duracağı kategori</Text>
          <View style={styles.categories} accessibilityRole="radiogroup" accessibilityLabel="Kategori">
            {categories.map((category) => {
              const selected = category.id === settings.category_id
              return (
                <Pressable
                  key={category.id}
                  onPress={() => onChange({ category_id: category.id })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category.name}</Text>
                </Pressable>
              )
            })}
            <Pressable
              onPress={onManageCategories}
              accessibilityRole="button"
              accessibilityLabel="Yeni kategori"
              accessibilityHint="Kategorilerin ayarlandığı kâğıdı açar"
              style={({ pressed }) => [styles.chip, styles.chipAdd, pressed && styles.pressed]}
            >
              <Ionicons name="add" size={16} color={colors.onInk} />
              <Text style={styles.chipText}>Yeni</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

// 3. adım (not defteri): sayfaların kâğıdı
function PaperStep({ settings, onChange }) {
  const { width } = useWindowDimensions()
  const tileWidth = (Math.min(width, 480) - 24 * 2 - 12 * 2) / 3

  return (
    <Section
      title="Sayfa yapısı"
      caption={`Defter ${FIRST_PAGE_COUNT} sayfayla başlar; son sayfayı çevirdikçe yeni sayfa eklenir.`}
    >
      <View style={styles.paperGrid} accessibilityRole="radiogroup">
        {PAPERS.map((paper) => {
          const selected = paper.value === settings.paper
          return (
            <Pressable
              key={paper.value}
              onPress={() => onChange({ paper: paper.value })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={paper.name}
              style={({ pressed }) => [
                styles.paperTile,
                { width: tileWidth },
                selected && styles.cardSelected,
                pressed && styles.pressed,
              ]}
            >
              <PaperSample style={paper.value} width={tileWidth - 16} />
              <Text style={styles.paperName}>{paper.name}</Text>
            </Pressable>
          )
        })}
      </View>
    </Section>
  )
}

// Kâğıdın küçük örneği: defter sayfasıyla aynı renkler, ölçeği küçültülmüş
function PaperSample({ style, width }) {
  const height = width * 1.3
  const line = width / 7
  const step = line / 2
  const margin = width * 0.2
  const rows = Math.floor(height / line)
  const cols = Math.floor(width / step)
  const gridRows = Math.floor(height / step)

  return (
    <Svg width={width} height={height}>
      <Rect width={width} height={height} rx={3} fill={notebook.paper} />
      {(style === 'ruled' || style === 'oxford') &&
        Array.from({ length: rows }, (_, i) => (
          <Line
            key={i}
            x1={0}
            x2={width}
            y1={(i + 1) * line}
            y2={(i + 1) * line}
            stroke={notebook.rule}
            strokeWidth={0.8}
          />
        ))}
      {style === 'oxford' && (
        <>
          <Line x1={margin} x2={margin} y1={0} y2={height} stroke={notebook.margin} strokeWidth={1} />
          <Line
            x1={margin + 2.5}
            x2={margin + 2.5}
            y1={0}
            y2={height}
            stroke={notebook.margin}
            strokeWidth={0.6}
          />
        </>
      )}
      {style === 'grid' && (
        <>
          {Array.from({ length: gridRows }, (_, i) => (
            <Line
              key={`r${i}`}
              x1={0}
              x2={width}
              y1={(i + 1) * step}
              y2={(i + 1) * step}
              stroke={notebook.rule}
              strokeWidth={0.6}
            />
          ))}
          {Array.from({ length: cols }, (_, i) => (
            <Line
              key={`c${i}`}
              x1={(i + 1) * step}
              x2={(i + 1) * step}
              y1={0}
              y2={height}
              stroke={notebook.rule}
              strokeWidth={0.6}
            />
          ))}
        </>
      )}
      {style === 'dot' &&
        Array.from({ length: gridRows * cols }, (_, i) => (
          <Circle
            key={i}
            cx={((i % cols) + 1) * step}
            cy={(Math.floor(i / cols) + 1) * step}
            r={0.9}
            fill={notebook.rule}
          />
        ))}
    </Svg>
  )
}

// 3. adım (PDF): sayfanın boyutu. Kâğıt beyaz ve çizgisizdir; boyut yalnızca oranını belirler.
function DocumentPaperStep({ settings, onChange }) {
  const { width } = useWindowDimensions()
  const tileWidth = (Math.min(width, 480) - 24 * 2 - 12) / 2

  return (
    <Section
      title="Sayfa boyutu"
      caption={`Sayfalar beyaz kâğıt; yazı basılı harflerle. Defter ${FIRST_PAGE_COUNT} sayfayla başlar, son sayfayı çevirdikçe yeni sayfa eklenir.`}
    >
      <View style={styles.paperGrid} accessibilityRole="radiogroup">
        {Object.keys(DOCUMENT_PAPERS).map((key) => {
          const paper = DOCUMENT_PAPERS[key]
          const selected = key === settings.paper
          return (
            <Pressable
              key={key}
              onPress={() => onChange({ paper: key })}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${paper.name}, ${paper.caption}`}
              style={({ pressed }) => [
                styles.paperTile,
                { width: tileWidth },
                selected && styles.cardSelected,
                pressed && styles.pressed,
              ]}
            >
              <DocumentSample ratio={paper.ratio} width={tileWidth * 0.5} />
              <Text style={styles.paperName}>{paper.name}</Text>
              <Text style={styles.cardCaption}>{paper.caption}</Text>
            </Pressable>
          )
        })}
      </View>
    </Section>
  )
}

// Beyaz kâğıdın küçük örneği: başlık ve birkaç satır basılı yazının izi
function DocumentSample({ ratio, width }) {
  const height = width * ratio
  const pad = width * 0.14
  const rows = [0.62, 0.9, 0.84, 0.9, 0.5, 0, 0.9, 0.76, 0.88, 0.4]
  const step = (height - pad * 2 - 10) / rows.length
  return (
    <Svg width={width} height={height}>
      <Rect width={width} height={height} rx={2} fill="#FFFFFF" />
      <Rect x={pad} y={pad} width={(width - pad * 2) * 0.55} height={5} rx={1} fill="#24292F" />
      {rows.map((w, i) =>
        w === 0 ? null : (
          <Rect
            key={i}
            x={pad}
            y={pad + 12 + i * step}
            width={(width - pad * 2) * w}
            height={2}
            rx={1}
            fill="#B9BEC5"
          />
        ),
      )}
    </Svg>
  )
}

// 3. adım (ajanda): yıl, sayfa düzeni ve şablonlar
function AgendaStep({ settings, onChange }) {
  const year = settings.year ?? new Date().getFullYear()
  const count = layoutOf(settings).count
  const habit = HABITS.find((h) => h.value === settings.habits)

  // Bir ayın sayfaları sırasıyla
  const order = [
    settings.month_goals && 'Ay hedefleri',
    settings.habits === 'month' && 'Alışkanlıklar',
    `4–5 hafta: ${[
      settings.weekly_pages && 'hedefler',
      settings.habits === 'week' && 'alışkanlıklar',
      '7 gün',
      settings.weekly_pages && 'değerlendirme',
    ]
      .filter(Boolean)
      .join(', ')}`,
    settings.month_review && 'Ay değerlendirmesi',
  ].filter(Boolean)

  return (
    <>
      <Section title="Yıl" caption="Ajanda bu yılın ocak ayından aralık ayına kadar sürer">
        <View style={styles.yearRow}>
          <YearButton
            icon="chevron-back"
            label="Önceki yıl"
            disabled={year <= FIRST_YEAR}
            onPress={() => onChange({ year: year - 1 })}
          />
          <Text style={styles.year} accessibilityRole="text">
            {year}
          </Text>
          <YearButton
            icon="chevron-forward"
            label="Sonraki yıl"
            disabled={year >= LAST_YEAR}
            onPress={() => onChange({ year: year + 1 })}
          />
        </View>
      </Section>

      <Section title="Sayfa düzeni">
        <CheckRow label="Günlük sayfalar" caption="Her güne bir sayfa" checked disabled />
        <CheckRow
          label="Aylık hedefler"
          caption="Her ayın başında"
          checked={settings.month_goals === 1}
          onPress={() => onChange({ month_goals: settings.month_goals ? 0 : 1 })}
        />
        <CheckRow
          label="Haftalık hedefler ve değerlendirme"
          caption="Her haftanın başında ve sonunda"
          checked={settings.weekly_pages === 1}
          onPress={() => onChange({ weekly_pages: settings.weekly_pages ? 0 : 1 })}
        />
        <CheckRow
          label="Aylık değerlendirme"
          caption="Her ayın sonunda"
          checked={settings.month_review === 1}
          onPress={() => onChange({ month_review: settings.month_review ? 0 : 1 })}
        />
      </Section>

      <Section title="Şablonlar" caption="Alışkanlık takibi">
        <Choice
          label="Alışkanlık takibi"
          options={HABITS}
          value={settings.habits}
          onChange={(habits) => onChange({ habits })}
        />
        <Text style={styles.caption}>{habit.caption}</Text>
      </Section>

      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>{`${year} · ${count} sayfa`}</Text>
        <Text style={styles.summaryText}>{`Her ay: ${order.join(' → ')}`}</Text>
      </View>
    </>
  )
}

function YearButton({ icon, label, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.yearButton, pressed && styles.backPressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={24} color={colors.onInk} />
    </Pressable>
  )
}

function CheckRow({ label, caption, checked, disabled, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={disabled ? 'rgba(244, 239, 230, 0.4)' : checked ? colors.accent : colors.onInk}
      />
      <View style={styles.checkText}>
        <Text style={[styles.checkLabel, disabled && styles.checkLabelFixed]}>{label}</Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </Pressable>
  )
}

// Yan yana seçenekler; biri seçilidir
function Choice({ label, options, value, onChange }) {
  return (
    <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            style={({ pressed }) => [
              styles.choiceOption,
              selected && styles.choiceSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.name}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// Kapak rengi: kapak bezinden bir yuvarlak, üstünde lastik bandın şeridi (telli defterde yok)
function Swatch({ name, cover, band, binding, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
      hitSlop={4}
      style={[styles.swatchRing, selected && styles.swatchRingOn]}
    >
      <View style={[styles.swatch, { backgroundColor: cover }]}>
        {binding === 'band' && <View style={[styles.swatchBand, { backgroundColor: band }]} />}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.ink,
  },
  header: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  headerText: {
    alignItems: 'center',
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: {
    backgroundColor: 'rgba(244, 239, 230, 0.15)',
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: type.title,
    color: colors.onInk,
  },
  stepText: {
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 1.5,
    color: colors.onInk,
  },
  body: {
    flex: 1,
    backgroundColor: shelf.wall,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontFamily: fonts.displayBold,
    fontSize: type.title,
    color: colors.onInk,
  },
  caption: {
    fontFamily: fonts.bodyThin,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onInk,
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginTop: 6,
  },
  kindCard: {
    gap: 6,
    padding: 12,
    paddingTop: 18,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'rgba(244, 239, 230, 0.12)',
    backgroundColor: 'rgba(244, 239, 230, 0.05)',
  },
  kindCover: {
    alignItems: 'center',
    paddingBottom: 10,
  },
  cardSoon: {
    opacity: 0.42,
  },
  soonTag: {
    position: 'absolute',
    top: 8,
    right: 10,
    fontFamily: fonts.hand,
    fontSize: 17,
    color: colors.onInk,
    zIndex: 1,
  },
  cardSelected: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(200, 85, 61, 0.12)',
  },
  pressed: {
    opacity: 0.8,
  },
  cardName: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.onInk,
  },
  cardCaption: {
    fontFamily: fonts.bodyThin,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onInk,
  },
  coverStep: {
    alignItems: 'center',
    gap: 20,
  },
  input: {
    padding: 0,
  },
  hint: {
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 1,
    color: colors.onInk,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    maxWidth: 5 * 44 + 4 * 10,
  },
  swatchRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchRingOn: {
    borderColor: colors.onInk,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(244, 239, 230, 0.25)',
  },
  swatchBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 8,
    width: 4,
  },
  categoryBlock: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  categoryLabel: {
    fontFamily: fonts.bodyThin,
    fontSize: type.caption,
    letterSpacing: 1,
    color: colors.onInk,
  },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(244, 239, 230, 0.3)',
  },
  chipSelected: {
    borderColor: colors.paper,
    backgroundColor: colors.paper,
  },
  chipAdd: {
    borderStyle: 'dashed',
    paddingLeft: 10,
  },
  chipText: {
    fontFamily: fonts.bodyThin,
    fontSize: 13,
    color: colors.onInk,
  },
  chipTextSelected: {
    fontFamily: fonts.bodyBold,
    color: colors.ink,
  },
  choice: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    padding: 4,
    gap: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(244, 239, 230, 0.08)',
  },
  choiceOption: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  choiceSelected: {
    backgroundColor: colors.paper,
  },
  choiceText: {
    fontFamily: fonts.bodyThin,
    fontSize: type.body,
    color: colors.onInk,
  },
  choiceTextSelected: {
    fontFamily: fonts.bodyBold,
    color: colors.ink,
  },
  paperGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  paperTile: {
    alignItems: 'center',
    gap: 8,
    padding: 6,
    paddingTop: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(244, 239, 230, 0.12)',
  },
  paperName: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.onInk,
  },
  yearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  yearButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 239, 230, 0.25)',
  },
  year: {
    minWidth: 120,
    textAlign: 'center',
    fontFamily: fonts.displayBold,
    fontSize: type.display,
    color: colors.onInk,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 6,
  },
  checkText: {
    flex: 1,
    gap: 2,
  },
  checkLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.onInk,
  },
  checkLabelFixed: {
    opacity: 0.6,
  },
  summary: {
    gap: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(244, 239, 230, 0.3)',
  },
  summaryTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    color: colors.onInk,
  },
  summaryText: {
    fontFamily: fonts.bodyThin,
    fontSize: 13,
    lineHeight: 19,
    color: colors.onInk,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: shelf.wall,
  },
  button: {
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    flex: 2,
    backgroundColor: colors.accent,
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(244, 239, 230, 0.35)',
  },
  disabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.bodyBold,
    fontSize: type.body,
    letterSpacing: 1,
    color: colors.onInk,
  },
})
