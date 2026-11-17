import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { HandDrawing } from './HandIcon'
import { TornPaperMenu } from '../components/TornPaperMenu'
import { formatClockTime, parseClockTime } from '../lib/marks'
import { fonts, HAND_TAIL, handTailWidth, notebook } from '../theme'

const DIGIT_SIZE = 56
// Basılı tutulunca ilk tekrar biraz bekler, sonra hızlanır
const HOLD_DELAY = 350
const HOLD_STEP = 70

// Saati elle ayarlamak: yırtık kâğıtta büyük el yazısıyla saat ve dakika, üstlerinde ve altlarında
// birer ok. Sayfada aşağı indikçe saat ilerlediği için aşağı ok saati ileri, yukarı ok geri alır.
// Ok basılı tutulursa sayılar akar; 23'ten sonra 00'a, 59'dan sonra 00'a döner. Rakamlara dokununca
// klavyeyle de yazılır: saatin iki hanesi yazılınca dakikaya geçilir. Kâğıtta ayrıca düğme yoktur:
// menü saati ayarlamak için açılmıştır, kâğıdın dışına dokununca kapanır ve saat yazılır.
export function TimeMenu({ visible, time, onClose }) {
  const [value, setValue] = useState(() => initialValue(time))
  const minutesInput = useRef(null)

  // Her açılışta bloğun saatiyle (yoksa o anki saatle) başlar
  const [wasVisible, setWasVisible] = useState(visible)
  if (wasVisible !== visible) {
    setWasVisible(visible)
    if (visible) setValue(initialValue(time))
  }

  const step = (unit, delta) =>
    setValue((prev) => {
      const mod = unit === 'hours' ? 24 : 60
      return { ...prev, [unit]: (prev[unit] + delta + mod) % mod }
    })

  return (
    <TornPaperMenu
      visible={visible}
      title="Saati ayarla"
      onClose={() => onClose(formatClockTime(value.hours, value.minutes))}
    >
      <View style={styles.clock}>
        <Column
          label="Saat"
          value={value.hours}
          max={23}
          onStep={(delta) => step('hours', delta)}
          onType={(hours) => setValue((prev) => ({ ...prev, hours }))}
          onFilled={() => minutesInput.current?.focus()}
        />
        <Text style={styles.colon}>{':' + HAND_TAIL}</Text>
        <Column
          label="Dakika"
          value={value.minutes}
          max={59}
          inputRef={minutesInput}
          onStep={(delta) => step('minutes', delta)}
          onType={(minutes) => setValue((prev) => ({ ...prev, minutes }))}
          onFilled={() => minutesInput.current?.blur()}
        />
      </View>
    </TornPaperMenu>
  )
}

function initialValue(time) {
  const now = new Date()
  return parseClockTime(time) ?? { hours: now.getHours(), minutes: now.getMinutes() }
}

function Column({ label, value, max, inputRef, onStep, onType, onFilled }) {
  // Klavyeyle yazılırken ekranda yazılan durur ("7" gibi tek hane); yazı alanından çıkınca
  // değer iki haneli olarak görünür
  const [draft, setDraft] = useState(null)
  const text = String(value).padStart(2, '0')

  function type(input) {
    const digits = input.replace(/\D/g, '').slice(0, 2)
    setDraft(digits)
    if (digits === '') return
    onType(Math.min(Number(digits), max))
    if (digits.length === 2) onFilled()
  }

  return (
    <View style={styles.column}>
      <StepButton shape="up" label={`${label} geri`} onStep={() => onStep(-1)} />
      <TextInput
        ref={inputRef}
        value={draft ?? text}
        onChangeText={type}
        onFocus={() => setDraft('')}
        onBlur={() => setDraft(null)}
        onSubmitEditing={onFilled}
        keyboardType="number-pad"
        returnKeyType="done"
        maxLength={2}
        selectTextOnFocus
        placeholder={text}
        placeholderTextColor="rgba(56, 56, 61, 0.3)"
        cursorColor={notebook.graphite}
        selectionColor="rgba(56, 56, 61, 0.25)"
        accessibilityLabel={`${label} ${text}`}
        style={styles.digits}
      />
      <StepButton shape="down" label={`${label} ileri`} onStep={() => onStep(1)} />
    </View>
  )
}

// Bir kez basınca bir adım; basılı tutunca adımlar tekrar eder. Okla oynanınca klavye kapanır.
function StepButton({ shape, label, onStep }) {
  const timer = useRef(null)
  const stepRef = useRef(onStep)

  useEffect(() => {
    stepRef.current = onStep
  })

  function stop() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  function repeat() {
    stepRef.current()
    timer.current = setTimeout(repeat, HOLD_STEP)
  }

  useEffect(() => stop, [])

  return (
    <Pressable
      onPressIn={() => {
        stop()
        Keyboard.dismiss()
        onStep()
        timer.current = setTimeout(repeat, HOLD_DELAY)
      }}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.step, pressed && styles.pressed]}
    >
      <HandDrawing shape={shape} size={34} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Kâğıdın kırmızı kenar çizgisinin sağında, ortada
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 30,
    paddingBottom: 10,
  },
  column: {
    alignItems: 'center',
  },
  // El yazısının sağa yatık kuyruğu kırpılmasın diye kutu rakamlardan biraz geniş
  digits: {
    width: 76,
    height: 64,
    padding: 0,
    fontFamily: fonts.handBold,
    fontSize: DIGIT_SIZE,
    textAlign: 'center',
    textAlignVertical: 'center',
    color: notebook.graphite,
  },
  colon: {
    marginRight: -handTailWidth(DIGIT_SIZE),
    fontFamily: fonts.handBold,
    fontSize: DIGIT_SIZE,
    lineHeight: 62,
    color: notebook.graphite,
  },
  step: {
    width: 52,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    backgroundColor: 'rgba(56, 56, 61, 0.08)',
  },
})
