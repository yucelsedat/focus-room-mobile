import Ionicons from '@expo/vector-icons/Ionicons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as Clipboard from 'expo-clipboard'

import { Pressable, StyleSheet, Text, View } from 'react-native'

import { BAR_HEIGHT, ToolRow } from './BottomBar'

import { NATIVE_PASTE_BUTTON } from '../lib/richText/usePasteRichText'
import { colors, docPage, fonts, highlightFill, highlighterOf, inkOf } from '../theme'

// PDF sayfasının alt çubuğu: biçimli yapıştır, kalem rengi, fosforlu kalem, başlık, kalın, italik, liste, görev kutusu, kod
// bloğu, sesle yazma ve ek. Düğmeler imlecin olduğu yazıya (seçiliyse seçime) uygulanır.
export function DocumentBar({
  bottomInset,
  listening,
  pen,
  onSwatchPress,
  onHighlighterPress,
  canPaste,
  onPaste,
  onPasteEvent,
  onHeading,
  onBold,
  onItalic,
  onBullet,
  onTask,
  onCode,
  onMicPress,
  onClipPress,
  notice,
}) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      {notice !== null && (
        <View pointerEvents="none" style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}
      <ToolRow>
        {NATIVE_PASTE_BUTTON ? (
          <Clipboard.ClipboardPasteButton
            acceptedContentTypes={['html']}
            displayMode="iconOnly"
            cornerStyle="medium"
            backgroundColor={docPage.ink}
            foregroundColor={docPage.sheet}
            onPress={onPasteEvent}
            style={styles.nativePaste}
          />
        ) : (
          <Tool label="Biçimli yapıştır" onPress={onPaste} disabled={!canPaste} accent>
            <Ionicons name="clipboard-outline" size={21} color={colors.accent} />
          </Tool>
        )}
        <Tool label="Kalem rengi" onPress={onSwatchPress}>
          <View
            style={[
              styles.swatch,
              {
                backgroundColor: pen.active ? highlighterOf(pen.color).color : inkOf(pen.ink).color,
              },
            ]}
          />
        </Tool>
        <Tool
          label={pen.active ? 'Fosforlu kalemi bırak' : 'Fosforlu kalem'}
          onPress={onHighlighterPress}
          selected={pen.active}
          tint={pen.active ? highlightFill(pen.color, 0.35) : undefined}
        >
          <MaterialCommunityIcons name="marker" size={21} color={docPage.ink} />
        </Tool>
        <Tool label="Başlık" onPress={onHeading}>
          <Text style={[styles.glyph, styles.glyphHeading]}>H</Text>
        </Tool>
        <Tool label="Kalın" onPress={onBold}>
          <Text style={[styles.glyph, styles.glyphBold]}>B</Text>
        </Tool>
        <Tool label="İtalik" onPress={onItalic}>
          <Text style={[styles.glyph, styles.glyphItalic]}>I</Text>
        </Tool>
        <Tool label="Madde işaretli liste" onPress={onBullet}>
          <Icon name="list" />
        </Tool>
        <Tool label="Görev kutusu" onPress={onTask}>
          <Icon name="checkbox-outline" />
        </Tool>
        <Tool label="Kod bloğu" onPress={onCode}>
          <Icon name="code-slash" />
        </Tool>
        <Tool label={listening ? 'Dinlemeyi durdur' : 'Sesle yaz'} onPress={onMicPress}>
          <Icon name={listening ? 'mic' : 'mic-outline'} color={listening ? colors.accent : undefined} />
        </Tool>
        <Tool label="Ek ekle" onPress={onClipPress}>
          <Icon name="attach" />
        </Tool>
      </ToolRow>
    </View>
  )
}

function Icon({ name, color }) {
  return <Ionicons name={name} size={21} color={color ?? docPage.ink} />
}

function Tool({ label, onPress, disabled, accent, selected, tint, children }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? { disabled } : { disabled, selected }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.tool,
        accent && styles.toolAccent,
        tint !== undefined && { backgroundColor: tint },
        pressed && styles.toolPressed,
        disabled && styles.toolDisabled,
      ]}
    >
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#F6F5F2',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(36, 41, 47, 0.18)',
  },
  tool: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolAccent: {
    backgroundColor: 'rgba(200, 85, 61, 0.1)',
  },
  toolPressed: {
    backgroundColor: 'rgba(36, 41, 47, 0.1)',
  },
  toolDisabled: {
    opacity: 0.35,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(36, 41, 47, 0.35)',
  },
  nativePaste: {
    width: 34,
    height: 34,
  },
  glyph: {
    color: docPage.ink,
    fontSize: 19,
    lineHeight: 22,
  },
  glyphHeading: {
    fontFamily: fonts.displayBold,
  },
  glyphBold: {
    fontFamily: fonts.bodyBold,
  },
  glyphItalic: {
    fontFamily: fonts.docItalic,
    fontSize: 20,
  },
  notice: {
    position: 'absolute',
    bottom: BAR_HEIGHT + 8,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  noticeText: {
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(36, 41, 47, 0.92)',
    color: '#FFFFFF',
    fontFamily: fonts.docBody,
    fontSize: 13,
    textAlign: 'center',
  },
})
