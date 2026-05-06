'use client';

import { useAskState } from '../../lib/hooks/useAskState';
import { AskComposer } from '../ask/AskComposer';
import { AskMessageList } from '../ask/AskMessageList';

export function AskView() {
  const askState = useAskState();

  return (
    <div className="ask-view">
      <AskMessageList
        history={askState.history}
        loading={askState.loading}
        streamingText={askState.streamingText}
        conceptCount={askState.conceptCount}
        suggestions={askState.suggestions}
        archiving={askState.archiving}
        messagesRef={askState.messagesRef}
        onSendSuggestion={askState.handleSend}
        onRestart={askState.restartConversation}
        onArchive={askState.handleArchive}
        onOpenConcept={askState.openConcept}
      />

      <AskComposer
        input={askState.input}
        setInput={askState.setInput}
        loading={askState.loading}
        selectedMentions={askState.selectedMentions}
        setSelectedMentions={askState.setSelectedMentions}
        referencePickerOpen={askState.referencePickerOpen}
        setReferencePickerOpen={askState.setReferencePickerOpen}
        referenceMode={askState.referenceMode}
        setReferenceMode={askState.setReferenceMode}
        pickerSearch={askState.pickerSearch}
        setPickerSearch={askState.setPickerSearch}
        pickerResults={askState.pickerResults}
        inlineResults={askState.inlineResults}
        modelMenuOpen={askState.modelMenuOpen}
        setModelMenuOpen={askState.setModelMenuOpen}
        llmConfig={askState.llmConfig}
        mounted={askState.mounted}
        showInlinePanel={askState.showInlinePanel}
        currentModelLabel={askState.currentModelLabel}
        modelOptions={askState.modelOptions}
        textareaRef={askState.textareaRef}
        composerRef={askState.composerRef}
        pickerSearchRef={askState.pickerSearchRef}
        autoResize={askState.autoResize}
        setCaretPosition={askState.setCaretPosition}
        onSelectMention={askState.handleSelectMention}
        onRemoveMention={askState.removeMention}
        onToggleReferencePicker={askState.toggleReferencePicker}
        onSelectModel={askState.selectModel}
        onSend={askState.handleSend}
      />
    </div>
  );
}
