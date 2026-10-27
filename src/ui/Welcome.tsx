import { t } from '../core/settings/language';
import { IconFile, IconFolder } from './Icons';

interface WelcomeProps {
  errorMessage: string | null;
  onNew: () => void;
  onOpen: () => void;
  nativeDialogs: boolean;
  samples: { path: string; name: string; description?: string }[];
  onOpenSample: (path: string) => void;
}

export function Welcome({ errorMessage, onNew, onOpen, nativeDialogs, samples, onOpenSample }: WelcomeProps) {
  return (
    <div className="welcome" data-testid="welcome">
      <div className="welcome__inner">
        <h1 className="welcome__title">{t("像写文档一样写 Markdown")}</h1>
        <p className="welcome__subtitle">
          {t("直接打开本地的 ")}<code>.md</code> {t(" 文件，所见即所得地编辑，保存回原文件。 不联网、不登录、不导入数据库。")}</p>

        {errorMessage && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 16 }}>{errorMessage}</p>
        )}

        <div className="welcome__actions">
          <button type="button" className="welcome__btn welcome__btn--primary" onClick={onOpen} data-testid="welcome-open">
            <IconFolder size={15} />
            {t("打开 Markdown 文件")}</button>
          <button type="button" className="welcome__btn" onClick={onNew} data-testid="welcome-new">
            <IconFile size={15} />
            {t("新建文档")}</button>
        </div>

        {!nativeDialogs && samples.length > 0 && (
          <div className="sample-list">
            <div className="sample-list__label">{t("浏览器演示文档（仅演示模式可用）")}</div>
            {samples.map((sample) => (
              <button
                key={sample.path}
                type="button"
                className="sample-item"
                data-testid={`sample-${sample.name}`}
                onClick={() => onOpenSample(sample.path)}
              >
                <div className="sample-item__name">{sample.name}</div>
                {sample.description && <div className="sample-item__desc">{sample.description}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
