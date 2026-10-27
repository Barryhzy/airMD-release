import { t } from './core/settings/language';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 顺序很重要：先变量，再 Crepe 主题，最后应用样式与编辑器微调
import './styles/tokens.css';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import './styles/app.css';
import './styles/editor.css';

import { App } from './ui/App';

const container = document.getElementById('root');
if (!container) throw new Error(t("找不到挂载节点 #root"));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
