/** Recursive response shape; used only by JSDoc checking, never at runtime. */
export interface SchemaFields { [key: string]: Schema }
export type Schema = 'string' | 'number' | SchemaFields | readonly Schema[];
