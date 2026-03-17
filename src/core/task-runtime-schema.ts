import type { TaskSchemaDefinition } from "./task-schema"

const TASK_RUNTIME_SCHEMA_EVENT = "mlo:task-runtime-schema-change"

let activeTaskRuntimeSchema: TaskSchemaDefinition | null = null

export function getActiveTaskRuntimeSchema(
  fallbackSchema: TaskSchemaDefinition,
): TaskSchemaDefinition {
  return activeTaskRuntimeSchema ?? fallbackSchema
}

export function setActiveTaskRuntimeSchema(schema: TaskSchemaDefinition) {
  activeTaskRuntimeSchema = schema
  window.dispatchEvent(
    new CustomEvent<TaskSchemaDefinition>(TASK_RUNTIME_SCHEMA_EVENT, {
      detail: schema,
    }),
  )
}

export function subscribeActiveTaskRuntimeSchema(
  onChange: (schema: TaskSchemaDefinition) => void,
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TaskSchemaDefinition>).detail
    if (detail != null) {
      onChange(detail)
    }
  }

  window.addEventListener(TASK_RUNTIME_SCHEMA_EVENT, listener)
  return () => {
    window.removeEventListener(TASK_RUNTIME_SCHEMA_EVENT, listener)
  }
}
