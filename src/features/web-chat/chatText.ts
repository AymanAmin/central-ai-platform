export function normalizeChatDisplayText(value:string){
  return value
    .replace(/\\r\\n/g,'\n')
    .replace(/\\n/g,'\n')
    .replace(/\\t/g,' ')
    .replace(/\*\*([^*\n]+)\*\*/g,'$1')
    .replace(/__([^_\n]+)__/g,'$1')
    .replace(/`([^`\n]+)`/g,'$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm,'')
    .replace(/^[ \t]*[-*][ \t]+/gm,'• ')
    .replace(/\n{3,}/g,'\n\n')
    .trim()
}
