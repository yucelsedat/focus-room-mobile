import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'

import { NotebookForm } from '../../library/components/NotebookForm'
import { getNotebook, updateNotebook } from '../../library/db'
import { shelf } from '../../library/theme'

// Defterin adını, kapağını, kategorisini ve (not defterinde) kâğıdını değiştirme; form, defter okunduktan sonra
// eski haliyle açılır
export default function EditNotebookScreen() {
  const { id } = useLocalSearchParams()
  const [notebook, setNotebook] = useState(null)

  useEffect(() => {
    let cancelled = false
    getNotebook(Number(id))
      .then((result) => {
        if (cancelled) return
        if (result) setNotebook(result)
        else throw new Error('Bu defter artık yok.')
      })
      .catch((err) => {
        if (cancelled) return
        Alert.alert('Defter açılamadı', err.message)
        if (router.canGoBack()) router.back()
        else router.replace('/')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!notebook) return <View style={styles.loading} />

  return (
    <NotebookForm
      mode="edit"
      initial={notebook}
      onSubmit={(settings) => updateNotebook(notebook.id, settings)}
    />
  )
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: shelf.wall,
  },
})
