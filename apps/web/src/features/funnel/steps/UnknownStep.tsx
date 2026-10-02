// A step type this build does not know (a newer config, an old cached bundle): the user
// can still continue instead of hitting a crash (CLAUDE.md 8.2).
import styles from './steps.module.css';

export function UnknownStep() {
  return (
    <>
      <h1 className={styles.title}>This step isn&apos;t available</h1>
      <p className={styles.helper}>Continue to the next step.</p>
    </>
  );
}
