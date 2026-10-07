/* Supplemental workflows opt into advanced controls; default UI is tested separately. */
async function openImportReview(page){
 await page.evaluate(()=>{
  for(const selector of ['#plan-import-source-files','#scene-review-files','[data-scene-audit]','[data-scene-entities]','[data-scene-partial-mode]','[data-scene-next-steps]','#building-registration-review']){
   const node=document.querySelector(selector);if(node)node.open=true;
  }
 });
}
module.exports={openImportReview};
