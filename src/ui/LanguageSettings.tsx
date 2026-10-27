import { useEffect, useState } from 'react';
import { errorMessage, readLanguage, saveLanguage, t, type Language } from '../core/settings/language';
import { Modal } from './Modal';

export function LanguageSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [language, setLanguage] = useState<Language>(readLanguage);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setLanguage(readLanguage());
      setError('');
      setNotice('');
    }
  }, [open]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4200);
    return () => clearTimeout(timer);
  }, [notice]);

  return <>
    {open && <Modal title={t('界面语言 / Language')} testId="language-modal" onClose={onClose}
      submitLabel={t('保存设置')} onSubmit={() => {
        try {
          saveLanguage(language);
          setNotice(t('语言设置已保存，重启 airMD 后生效。'));
          onClose();
        } catch (cause) {
          setError(t('无法保存语言设置：{0}', { '0': errorMessage(cause) }));
        }
      }}>
      <fieldset className="language-options">
        <legend>{t('界面语言')}</legend>
        <label className="language-option">
          <input type="radio" name="language" value="zh-CN" checked={language === 'zh-CN'} onChange={() => setLanguage('zh-CN')} />
          <span lang="zh-CN">简体中文</span>
        </label>
        <label className="language-option">
          <input type="radio" name="language" value="en" checked={language === 'en'} onChange={() => setLanguage('en')} />
          <span lang="en">English</span>
        </label>
      </fieldset>
      <p>{t('只影响应用界面，不更改系统语言、文档内容或已有文件名。')}</p>
      <p>{t('重启 airMD 后生效；退出前请保存所有标签中的改动。')}</p>
      {error && <p className="language-error" role="alert">{error}</p>}
    </Modal>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </>;
}
