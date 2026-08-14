declare module '*.css' {
  /** Prefixed class map for a CSS Modules import. */
  const classes: Record<string, string>
  export default classes
}

declare module '*.css?raw' {
  /** Prefixed stylesheet text for apply-time style injection. */
  const text: string
  export default text
}
