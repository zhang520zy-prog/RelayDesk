import i18n from "@/i18n";
import zh from "./locales/zh.json";
import en from "./locales/en.json";
export function installRelayTranslations() {
  i18n.addResourceBundle("zh", "relaydesk", zh, true, true);
  i18n.addResourceBundle("en", "relaydesk", en, true, true);
}
installRelayTranslations();
