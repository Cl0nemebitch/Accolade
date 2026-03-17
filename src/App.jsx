import { useEffect } from 'react';
import legacyHtml from './legacy.html?raw';
import { initLegacy } from './legacy.js';

export default function App() {
  useEffect(() => {
    initLegacy();
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: legacyHtml }} />;
}
