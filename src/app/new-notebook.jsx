import { useLocalSearchParams } from 'expo-router'

import { defaultSettings, NotebookForm } from '../library/components/NotebookForm'
import { createNotebook, GENERAL_CATEGORY_ID } from '../library/db'

// Kitaplıktan açılınca o an seçili kategori önceden seçili gelir; başka yerden açılınca Genel
export default function NewNotebookScreen() {
  const { category } = useLocalSearchParams()
  const categoryId = Number(category) || GENERAL_CATEGORY_ID
  return (
    <NotebookForm
      mode="create"
      initial={{ ...defaultSettings(), category_id: categoryId }}
      onSubmit={(settings) => createNotebook(settings)}
    />
  )
}
