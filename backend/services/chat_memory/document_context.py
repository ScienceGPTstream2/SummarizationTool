from typing import Optional

from services.document.organized_file_service import get_organized_file_service
from services.session.session_service import get_session_service

MAX_ATTACHED_SESSION_CONTEXT_CHARS = 200_000


def _build_document_block(filename: str, file_hash: str, markdown: str) -> str:
    return (
        f'<document name="{filename}" file_hash="{file_hash}">\n'
        f"{markdown}\n"
        "</document>"
    )


async def build_attached_session_context(
    user_id: str,
    attached_session_id: Optional[str],
    session_service=None,
    file_service=None,
) -> Optional[str]:
    if not attached_session_id:
        return None

    session_service = session_service or get_session_service()
    file_service = file_service or get_organized_file_service()

    session = session_service.get_session(user_id, attached_session_id)
    if session is None:
        return None

    document_blocks = []
    current_length = 0
    separator = "\n\n"

    for document in session.documents:
        processor_used = document.processor_used or "azure_doc_intelligence"
        markdown = await file_service.get_processed_content(
            document.file_hash, processor_used
        )
        if not markdown:
            continue

        block = _build_document_block(document.filename, document.file_hash, markdown)
        separator_length = len(separator) if document_blocks else 0
        remaining_budget = MAX_ATTACHED_SESSION_CONTEXT_CHARS - current_length - separator_length
        if remaining_budget <= 0:
            break

        if len(block) > remaining_budget:
            if document_blocks:
                break

            opening_tag = f'<document name="{document.filename}" file_hash="{document.file_hash}">\n'
            closing_tag = "\n</document>"
            max_markdown_length = remaining_budget - len(opening_tag) - len(closing_tag)
            if max_markdown_length <= 0:
                break
            block = _build_document_block(
                document.filename,
                document.file_hash,
                markdown[:max_markdown_length],
            )
            if len(block) > remaining_budget:
                block = block[:remaining_budget]
                if not block.endswith(closing_tag):
                    content_budget = max(0, remaining_budget - len(opening_tag) - len(closing_tag))
                    block = opening_tag + markdown[:content_budget] + closing_tag

        document_blocks.append(block)
        current_length += separator_length + len(block)

        if current_length >= MAX_ATTACHED_SESSION_CONTEXT_CHARS:
            break

    return "\n\n".join(document_blocks) if document_blocks else None
