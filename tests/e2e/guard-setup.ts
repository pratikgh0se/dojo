import { dojoBaseUrl } from '../../dojoPort'
import { checkServerNotRealDojo } from './guard'

/** Global setup for configs without their own: refuse to test against the real ~/Dojo (C3). */
export default async function guardSetup() {
  await checkServerNotRealDojo(dojoBaseUrl(process.env))
}
