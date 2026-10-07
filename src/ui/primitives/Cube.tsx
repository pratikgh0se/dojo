export function Cube({ on = false, size = 10 }: { on?: boolean; size?: number }) {
  return <span className="sr-cube" data-on={on ? 'true' : 'false'} style={{ width: size, height: size }} aria-hidden="true" />
}
