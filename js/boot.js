/* Mostra na tela qualquer erro de JavaScript (ajuda a descobrir por que a página não abre). */
window.onerror=function(msg,src,line){
  var b=document.getElementById("boot");
  if(b){
    b.hidden=false;
    b.textContent="Erro no script: "+String(msg)+" (linha "+line+" de "+String(src||"").split("/").pop()+")";
  }
};
