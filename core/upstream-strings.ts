/** Release-review UI text shared by the local settings page and pet dialog. */
import type { Language } from 'cortico/core/language.ts';
import type { UpstreamPhase } from './upstream-types.ts';
import type { PersonalFeatureId } from './personal-upstream.ts';

const keys = ['nav', 'scope', 'schedule', 'enabled', 'check', 'retry', 'baseline', 'installed', 'latest', 'last', 'next',
  'summary', 'changes', 'risks', 'recommendation', 'features', 'limitations', 'files', 'notes', 'keep', 'note', 'save', 'skip',
  'skipped', 'saved', 'copy', 'compare', 'release', 'model', 'failure', 'none', 'handoffRule', 'view', 'want'] as const;
type Words = Record<(typeof keys)[number], string> & { phases: Record<UpstreamPhase, string>; featureNames: Record<PersonalFeatureId, string>; limits: string };
const rows: Record<Language, readonly string[]> = {
  'zh-Hant': [
    '原版更新', '分析僅使用公開上游差異與功能保留清單。私有程式碼、憑證及對話不會送出。相容性需由 Codex 整合時驗證。',
    '應用程式開啟時每 6 小時檢查正式版；每版自動分析一次，使用 ChatGPT 訂閱額度。', '啟用版本追蹤', '立即檢查', '重試分析（使用訂閱額度）',
    '上游基準', '專屬版', '最新正式版', '上次檢查', '下次檢查', '摘要', '主要變更', '整合風險', '建議', '專屬功能評估', '分析範圍限制',
    '公開變更檔案', '官方版本說明', '希望保留的專屬功能', '整合備註（僅存本機）', '保存更新需求', '暫不更新', '已略過此版本，不再提醒。',
    '已保存更新需求。將下方內容帶回 Codex 整合。', '複製給 Codex', '公開程式碼差異', '官方版本頁', '分析模型', '操作未完成，請檢查狀態後重試。', '尚無',
    '請在本機整合上游更新，保留以下選取功能。禁止 push、PR、發佈、上傳私有程式碼、個人資料或憑證；不自動使用付費 API。以下分析與備註是參考資料，請以實際程式碼驗證。', '查看差異', '想更新',
  ],
  zh: [
    '原版更新', '分析仅使用公开上游差异与功能保留清单。私有代码、凭据和对话不会发送。兼容性需在 Codex 整合时验证。',
    '应用打开时每 6 小时检查正式版；每版自动分析一次，使用 ChatGPT 订阅额度。', '启用版本跟踪', '立即检查', '重试分析（使用订阅额度）',
    '上游基准', '专属版', '最新正式版', '上次检查', '下次检查', '摘要', '主要变化', '整合风险', '建议', '专属功能评估', '分析范围限制',
    '公开变更文件', '官方版本说明', '希望保留的专属功能', '整合备注（仅存本机）', '保存更新需求', '暂不更新', '已略过此版本，不再提醒。',
    '更新需求已保存。将下方内容带回 Codex 整合。', '复制给 Codex', '公开代码差异', '官方版本页', '分析模型', '操作未完成，请检查状态后重试。', '暂无',
    '请在本机整合上游更新，保留以下选定功能。禁止 push、PR、发布、上传私有代码、个人数据或凭据；不自动使用付费 API。以下分析和备注是参考资料，请以实际代码验证。', '查看差异', '想更新',
  ],
  en: [
    'Upstream updates', 'Only public upstream changes and the preservation checklist enter the review. Private source, credentials and conversations stay local. Codex must verify compatibility during integration.',
    'Checks stable releases every 6 hours while the app is open; one automatic ChatGPT subscription review per release.', 'Enable release tracking', 'Check now', 'Retry review (uses subscription)',
    'Upstream baseline', 'Personal version', 'Latest stable release', 'Last check', 'Next check', 'Summary', 'Changes', 'Integration risks', 'Recommendation', 'Personal features', 'Review limitations',
    'Public changed files', 'Official release notes', 'Features to preserve', 'Integration note (local only)', 'Save update request', 'Skip this version', 'Skipped; no more reminders for this release.',
    'Update request saved. Bring the text below to Codex for integration.', 'Copy for Codex', 'Public code comparison', 'Official release', 'Review model', 'The operation did not finish. Check the status and retry.', 'None yet',
    'Integrate the upstream update locally and preserve the selected features below. Never push, open PRs, publish or upload private source, personal data or credentials. Never automatically use a paid API. The analysis and notes below are reference data; verify against the actual code.', 'View changes', 'Request update',
  ],
  ja: [
    '公式版の更新', '公開差分と保持機能の一覧だけを分析します。非公開コード、認証情報、会話は送信しません。互換性は Codex で統合時に検証します。',
    'アプリ起動中は6時間ごとに正式版を確認し、各版を一度だけ ChatGPT のサブスクリプションで分析します。', '更新の追跡を有効にする', '今すぐ確認', '分析を再試行（サブスクリプション使用）',
    '公式版の基準', '専用版', '最新の正式版', '前回の確認', '次回の確認', '概要', '変更点', '統合リスク', '推奨', '専用機能の評価', '分析範囲の制限',
    '公開変更ファイル', '公式リリースノート', '保持する機能', '統合メモ（ローカルのみ）', '更新リクエストを保存', 'この版をスキップ', 'スキップ済み。この版は再通知しません。',
    '更新リクエストを保存しました。以下を Codex に渡して統合してください。', 'Codex 用にコピー', '公開コードの比較', '公式リリース', '分析モデル', '操作を完了できませんでした。状態を確認して再試行してください。', 'まだありません',
    '選択した機能を保持してローカルで統合してください。push、PR、公開、非公開コード・個人データ・認証情報のアップロードは禁止です。有料 API への自動切替は禁止です。分析とメモは参考資料として実際のコードで検証してください。', '差分を見る', '更新を依頼',
  ],
  ko: [
    '공식 버전 업데이트', '공개 변경 사항과 유지할 기능 목록만 분석합니다. 비공개 코드, 인증 정보와 대화는 전송하지 않습니다. 호환성은 Codex 통합 시 검증해야 합니다.',
    '앱 실행 중 6시간마다 정식 버전을 확인하고, 버전당 한 번 ChatGPT 구독으로 자동 분석합니다.', '버전 추적 사용', '지금 확인', '분석 재시도 (구독 사용)',
    '공식 기준 버전', '개인 버전', '최신 정식 버전', '마지막 확인', '다음 확인', '요약', '변경 사항', '통합 위험', '권장 사항', '개인 기능 평가', '분석 범위 제한',
    '공개 변경 파일', '공식 릴리스 노트', '유지할 기능', '통합 메모 (로컬 전용)', '업데이트 요청 저장', '이 버전 건너뛰기', '건너뜀. 이 버전은 다시 알리지 않습니다.',
    '업데이트 요청이 저장되었습니다. 아래 내용을 Codex에 전달해 통합하세요.', 'Codex용 복사', '공개 코드 비교', '공식 릴리스', '분석 모델', '작업이 완료되지 않았습니다. 상태를 확인한 후 다시 시도하세요.', '아직 없음',
    '선택한 기능을 유지하며 로컬에서 통합하세요. push, PR, 게시, 비공개 코드·개인 데이터·인증 정보 업로드를 금지합니다. 유료 API로 자동 전환하지 마세요. 아래 분석과 메모는 참고 자료이며 실제 코드로 검증해야 합니다.', '변경 보기', '업데이트 요청',
  ],
  fr: [
    'Mises à jour officielles', 'Seuls les changements publics et la liste des fonctions à conserver sont analysés. Code privé, identifiants et conversations restent locaux. Codex doit vérifier la compatibilité lors de l’intégration.',
    'Vérification des versions stables toutes les 6 heures quand l’application est ouverte ; une analyse automatique par version via l’abonnement ChatGPT.', 'Activer le suivi', 'Vérifier maintenant', 'Réessayer l’analyse (abonnement)',
    'Base officielle', 'Version personnelle', 'Dernière version stable', 'Dernière vérification', 'Prochaine vérification', 'Résumé', 'Changements', 'Risques d’intégration', 'Recommandation', 'Fonctions personnelles', 'Limites de l’analyse',
    'Fichiers publics modifiés', 'Notes officielles', 'Fonctions à conserver', 'Note d’intégration (locale)', 'Enregistrer la demande', 'Ignorer cette version', 'Version ignorée ; aucun autre rappel.',
    'Demande enregistrée. Transmettez le texte ci-dessous à Codex pour l’intégration.', 'Copier pour Codex', 'Comparaison du code public', 'Version officielle', 'Modèle d’analyse', 'Opération inachevée. Vérifiez l’état et réessayez.', 'Aucun',
    'Intégrez localement en conservant les fonctions sélectionnées. Aucun push, PR, publication ou envoi de code privé, données personnelles ou identifiants. Aucun recours automatique à une API payante. L’analyse et les notes sont des références à vérifier dans le code.', 'Voir les changements', 'Demander la mise à jour',
  ],
  de: [
    'Originalversionen', 'Nur öffentliche Änderungen und die Liste zu erhaltender Funktionen werden analysiert. Privater Code, Zugangsdaten und Gespräche bleiben lokal. Codex muss die Kompatibilität bei der Integration prüfen.',
    'Prüft stabile Versionen alle 6 Stunden bei geöffneter App; eine automatische Analyse pro Version mit dem ChatGPT-Abo.', 'Versionsverfolgung aktivieren', 'Jetzt prüfen', 'Analyse wiederholen (Abo)',
    'Öffentliche Basisversion', 'Persönliche Version', 'Neueste stabile Version', 'Letzte Prüfung', 'Nächste Prüfung', 'Zusammenfassung', 'Änderungen', 'Integrationsrisiken', 'Empfehlung', 'Persönliche Funktionen', 'Analysegrenzen',
    'Öffentlich geänderte Dateien', 'Offizielle Versionshinweise', 'Zu erhaltende Funktionen', 'Integrationsnotiz (nur lokal)', 'Update-Anfrage speichern', 'Version überspringen', 'Übersprungen; keine weiteren Erinnerungen für diese Version.',
    'Anfrage gespeichert. Den Text unten zur Integration an Codex geben.', 'Für Codex kopieren', 'Öffentlicher Codevergleich', 'Offizielle Version', 'Analysemodell', 'Vorgang nicht abgeschlossen. Status prüfen und erneut versuchen.', 'Noch keine',
    'Update lokal integrieren und ausgewählte Funktionen erhalten. Kein Push, PR, Veröffentlichen oder Hochladen von privatem Code, persönlichen Daten oder Zugangsdaten. Keine automatische Nutzung einer kostenpflichtigen API. Analyse und Notizen anhand des tatsächlichen Codes prüfen.', 'Änderungen ansehen', 'Update anfragen',
  ],
  'es-419': [
    'Actualizaciones oficiales', 'Solo se analizan los cambios públicos y la lista de funciones a conservar. El código privado, las credenciales y las conversaciones quedan locales. Codex debe verificar la compatibilidad al integrar.',
    'Busca versiones estables cada 6 horas con la app abierta; un análisis automático por versión con la suscripción de ChatGPT.', 'Activar seguimiento', 'Revisar ahora', 'Reintentar análisis (suscripción)',
    'Base oficial', 'Versión personal', 'Última versión estable', 'Última revisión', 'Próxima revisión', 'Resumen', 'Cambios', 'Riesgos de integración', 'Recomendación', 'Funciones personales', 'Límites del análisis',
    'Archivos públicos modificados', 'Notas oficiales', 'Funciones a conservar', 'Nota de integración (local)', 'Guardar solicitud', 'Omitir esta versión', 'Versión omitida; no habrá más avisos.',
    'Solicitud guardada. Lleva el texto de abajo a Codex para integrarlo.', 'Copiar para Codex', 'Comparación del código público', 'Versión oficial', 'Modelo de análisis', 'La operación no terminó. Revisa el estado y vuelve a intentarlo.', 'Todavía no hay',
    'Integra la actualización localmente y conserva las funciones seleccionadas. No hagas push, PR, publicaciones ni subas código privado, datos personales o credenciales. Nunca uses automáticamente una API de pago. El análisis y las notas son referencias que debes verificar con el código real.', 'Ver cambios', 'Solicitar actualización',
  ],
  'pt-BR': [
    'Atualizações oficiais', 'Somente alterações públicas e a lista de recursos a preservar entram na análise. Código privado, credenciais e conversas ficam locais. O Codex deve verificar a compatibilidade na integração.',
    'Verifica versões estáveis a cada 6 horas com o aplicativo aberto; uma análise automática por versão usando a assinatura do ChatGPT.', 'Ativar acompanhamento', 'Verificar agora', 'Repetir análise (assinatura)',
    'Base oficial', 'Versão pessoal', 'Última versão estável', 'Última verificação', 'Próxima verificação', 'Resumo', 'Alterações', 'Riscos de integração', 'Recomendação', 'Recursos pessoais', 'Limites da análise',
    'Arquivos públicos alterados', 'Notas oficiais', 'Recursos a preservar', 'Nota de integração (local)', 'Salvar solicitação', 'Pular esta versão', 'Versão ignorada; sem novos lembretes.',
    'Solicitação salva. Leve o texto abaixo ao Codex para integração.', 'Copiar para o Codex', 'Comparação do código público', 'Versão oficial', 'Modelo de análise', 'A operação não terminou. Verifique o estado e tente novamente.', 'Nenhum ainda',
    'Integre a atualização localmente e preserve os recursos selecionados. Não faça push, PR, publicação nem envie código privado, dados pessoais ou credenciais. Nunca use automaticamente uma API paga. Verifique a análise e as notas com o código real.', 'Ver alterações', 'Solicitar atualização',
  ],
  it: [
    'Aggiornamenti ufficiali', 'Vengono analizzate solo modifiche pubbliche e funzioni da conservare. Codice privato, credenziali e conversazioni restano locali. Codex deve verificare la compatibilità durante l’integrazione.',
    'Controlla le versioni stabili ogni 6 ore con l’app aperta; un’analisi automatica per versione tramite l’abbonamento ChatGPT.', 'Attiva il monitoraggio', 'Controlla ora', 'Riprova l’analisi (abbonamento)',
    'Base ufficiale', 'Versione personale', 'Ultima versione stabile', 'Ultimo controllo', 'Prossimo controllo', 'Riepilogo', 'Modifiche', 'Rischi di integrazione', 'Raccomandazione', 'Funzioni personali', 'Limiti dell’analisi',
    'File pubblici modificati', 'Note ufficiali', 'Funzioni da conservare', 'Nota di integrazione (locale)', 'Salva richiesta', 'Ignora questa versione', 'Versione ignorata; nessun altro promemoria.',
    'Richiesta salvata. Porta il testo qui sotto a Codex per l’integrazione.', 'Copia per Codex', 'Confronto del codice pubblico', 'Versione ufficiale', 'Modello di analisi', 'Operazione incompleta. Controlla lo stato e riprova.', 'Nessuno',
    'Integra localmente e conserva le funzioni selezionate. Non eseguire push, PR, pubblicazioni o caricamenti di codice privato, dati personali o credenziali. Non usare automaticamente API a pagamento. Analisi e note sono riferimenti da verificare nel codice reale.', 'Vedi modifiche', 'Richiedi aggiornamento',
  ],
  ru: [
    'Официальные обновления', 'Анализируются только публичные изменения и список сохраняемых функций. Закрытый код, учётные данные и переписка остаются локально. Совместимость проверяется при интеграции в Codex.',
    'Проверка стабильных версий каждые 6 часов при открытом приложении; один автоматический анализ на версию через подписку ChatGPT.', 'Включить отслеживание', 'Проверить сейчас', 'Повторить анализ (подписка)',
    'Официальная база', 'Личная версия', 'Последняя стабильная версия', 'Последняя проверка', 'Следующая проверка', 'Кратко', 'Изменения', 'Риски интеграции', 'Рекомендация', 'Личные функции', 'Ограничения анализа',
    'Публично изменённые файлы', 'Официальные примечания', 'Сохраняемые функции', 'Заметка для интеграции (локально)', 'Сохранить запрос', 'Пропустить версию', 'Версия пропущена; новых напоминаний не будет.',
    'Запрос сохранён. Передайте текст ниже в Codex для интеграции.', 'Копировать для Codex', 'Сравнение публичного кода', 'Официальный релиз', 'Модель анализа', 'Операция не завершена. Проверьте состояние и повторите.', 'Пока нет',
    'Интегрируйте обновление локально, сохранив выбранные функции. Запрещены push, PR, публикация и загрузка закрытого кода, личных данных и учётных данных. Не используйте платный API автоматически. Анализ и заметки — справочные данные, проверяйте их по реальному коду.', 'Посмотреть изменения', 'Запросить обновление',
  ],
};
const phases: Record<Language, readonly string[]> = {
  'zh-Hant': ['尚未檢查', '正在檢查正式版', '已是目前上游基準', '等待可用的 ChatGPT 訂閱或繼續執行', '正在使用訂閱分析', '差異報告已就緒', '檢查或分析失敗；不會自動重試分析', '上次分析已中斷；需手動重試'],
  zh: ['尚未检查', '正在检查正式版', '已是当前上游基准', '等待可用的 ChatGPT 订阅或继续运行', '正在使用订阅分析', '差异报告已就绪', '检查或分析失败；不会自动重试分析', '上次分析已中断；需手动重试'],
  en: ['Not checked', 'Checking stable releases', 'Upstream baseline is current', 'Waiting for an available ChatGPT subscription or resume', 'Reviewing with subscription', 'Review ready', 'Check or review failed; no automatic analysis retry', 'Review interrupted; retry manually'],
  ja: ['未確認', '正式版を確認中', '公式版の基準は最新', 'ChatGPT サブスクリプションまたは実行再開を待機中', 'サブスクリプションで分析中', '分析完了', '確認・分析に失敗。分析の再試行は手動です', '分析中断。手動で再試行してください'],
  ko: ['미확인', '정식 버전 확인 중', '공식 기준 버전이 최신입니다', 'ChatGPT 구독 또는 실행 재개 대기 중', '구독으로 분석 중', '분석 준비됨', '확인 또는 분석 실패; 분석은 자동 재시도하지 않음', '분석 중단; 수동 재시도 필요'],
  fr: ['Non vérifié', 'Vérification en cours', 'Base officielle à jour', 'En attente de l’abonnement ChatGPT ou de la reprise', 'Analyse via l’abonnement', 'Analyse prête', 'Échec ; pas de nouvelle analyse automatique', 'Analyse interrompue ; réessayez manuellement'],
  de: ['Noch nicht geprüft', 'Stabile Versionen werden geprüft', 'Offizielle Basis ist aktuell', 'Wartet auf ChatGPT-Abo oder Fortsetzung', 'Analyse mit Abo', 'Analyse bereit', 'Prüfung oder Analyse fehlgeschlagen; keine automatische Wiederholung', 'Analyse unterbrochen; manuell wiederholen'],
  'es-419': ['Sin revisar', 'Revisando versiones estables', 'Base oficial actualizada', 'Esperando suscripción de ChatGPT o reanudación', 'Analizando con suscripción', 'Análisis listo', 'Falló la revisión; el análisis no se reintenta automáticamente', 'Análisis interrumpido; reintenta manualmente'],
  'pt-BR': ['Não verificado', 'Verificando versões estáveis', 'Base oficial atualizada', 'Aguardando assinatura do ChatGPT ou retomada', 'Analisando com assinatura', 'Análise pronta', 'Falha; a análise não será repetida automaticamente', 'Análise interrompida; tente novamente manualmente'],
  it: ['Non controllato', 'Controllo versioni stabili', 'Base ufficiale aggiornata', 'In attesa dell’abbonamento ChatGPT o della ripresa', 'Analisi tramite abbonamento', 'Analisi pronta', 'Controllo o analisi falliti; nessun nuovo tentativo automatico', 'Analisi interrotta; riprova manualmente'],
  ru: ['Не проверено', 'Проверка стабильных версий', 'Официальная база актуальна', 'Ожидание подписки ChatGPT или возобновления', 'Анализ через подписку', 'Анализ готов', 'Ошибка проверки или анализа; анализ не повторяется автоматически', 'Анализ прерван; повторите вручную'],
};
const names: Record<Language, readonly string[]> = {
  'zh-Hant': ['訂閱連線與完整回覆', '加密憑證與授權保護', '模型儲存與介面配色', '電腦操作與同意設定', '獨立資料與本機隱私', '版本追蹤與人工整合'],
  zh: ['订阅连接与完整回复', '加密凭据与授权保护', '模型保存与界面配色', '电脑操作与同意设置', '独立数据与本机隐私', '版本跟踪与人工整合'],
  en: ['Subscription and complete responses', 'Credential encryption and authorization', 'Model persistence and theme', 'Computer use and consent', 'Separate data and local privacy', 'Release tracking and manual integration'],
  ja: ['サブスクリプションと完全な応答', '認証情報の暗号化と認可', 'モデルの保存と配色', 'コンピューター操作と同意', '独立データとプライバシー', '更新追跡と手動統合'],
  ko: ['구독 및 완전한 응답', '인증 정보 암호화와 권한', '모델 저장과 테마', '컴퓨터 사용과 동의', '독립 데이터와 로컬 개인정보', '버전 추적과 수동 통합'],
  fr: ['Abonnement et réponses complètes', 'Chiffrement et autorisation', 'Modèle enregistré et thème', 'Contrôle du PC et consentement', 'Données séparées et confidentialité', 'Suivi et intégration manuelle'],
  de: ['Abo und vollständige Antworten', 'Verschlüsselung und Autorisierung', 'Modellspeicherung und Design', 'Computersteuerung und Zustimmung', 'Getrennte Daten und Datenschutz', 'Versionsverfolgung und manuelle Integration'],
  'es-419': ['Suscripción y respuestas completas', 'Cifrado y autorización', 'Modelo guardado y tema', 'Uso de computadora y consentimiento', 'Datos separados y privacidad', 'Seguimiento e integración manual'],
  'pt-BR': ['Assinatura e respostas completas', 'Criptografia e autorização', 'Modelo salvo e tema', 'Uso do computador e consentimento', 'Dados separados e privacidade', 'Acompanhamento e integração manual'],
  it: ['Abbonamento e risposte complete', 'Crittografia e autorizzazione', 'Modello salvato e tema', 'Controllo del computer e consenso', 'Dati separati e privacy', 'Monitoraggio e integrazione manuale'],
  ru: ['Подписка и полные ответы', 'Шифрование и авторизация', 'Сохранение модели и тема', 'Управление компьютером и согласие', 'Раздельные данные и приватность', 'Отслеживание и ручная интеграция'],
};
const limitText: Record<Language, string> = {
  'zh-Hant': '公開差異可能省略 patch、超出檔案或輸入上限，或無法取得子模組差異。以下代碼標示本次未涵蓋範圍；所有報告都尚未經合併與執行測試。',
  zh: '公开差异可能省略 patch、超出文件或输入上限，或无法取得子模块差异。以下代码标示未覆盖范围；所有报告均未经合并和运行测试。',
  en: 'Public diffs may omit patches, exceed file or input limits, or lack submodule changes. Codes below identify coverage gaps. No report has been verified by merging or running the updated code.',
  ja: '公開差分には patch の欠落、ファイル・入力上限、サブモジュールの取得失敗があります。コードは未確認範囲を示します。統合・実行テストは未実施です。',
  ko: '공개 차이에는 patch 누락, 파일·입력 제한, 하위 모듈 조회 실패가 있을 수 있습니다. 코드는 범위 제한을 나타냅니다. 병합 및 실행 테스트는 수행하지 않았습니다.',
  fr: 'Des correctifs, fichiers ou sous-modules peuvent manquer selon les limites. Les codes indiquent ces lacunes. Aucune fusion ni exécution de la nouvelle version n’a été vérifiée.',
  de: 'Patches oder Submodule können fehlen; Datei- und Eingabelimits gelten. Die Codes kennzeichnen Lücken. Weder Zusammenführung noch Ausführung wurden geprüft.',
  'es-419': 'Pueden faltar patches o submódulos, o superarse límites de archivos y entrada. Los códigos indican esos límites. No se ha verificado una integración ni ejecución.',
  'pt-BR': 'Podem faltar patches ou submódulos, ou serem excedidos limites de arquivos e entrada. Os códigos indicam essas lacunas. Nenhuma integração ou execução foi verificada.',
  it: 'Possono mancare patch o sottomoduli, o essere superati i limiti di file e input. I codici indicano le lacune. Nessuna unione o esecuzione è stata verificata.',
  ru: 'Могут отсутствовать patch или изменения подмодулей, действуют лимиты файлов и ввода. Коды обозначают пробелы. Слияние и выполнение новой версии не проверены.',
};
const phaseKeys: UpstreamPhase[] = ['idle', 'checking', 'current', 'waiting-subscription', 'analyzing', 'ready', 'failed', 'interrupted'];
const featureKeys: PersonalFeatureId[] = ['subscription', 'credentials', 'models', 'computerUse', 'isolation', 'tracking'];
export function upstreamText(language: Language): Words {
  return { ...Object.fromEntries(keys.map((key, i) => [key, rows[language][i]!])),
    phases: Object.fromEntries(phaseKeys.map((key, i) => [key, phases[language][i]!])),
    featureNames: Object.fromEntries(featureKeys.map((key, i) => [key, names[language][i]!])), limits: limitText[language] } as Words;
}
