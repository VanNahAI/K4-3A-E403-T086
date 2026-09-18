(function exposeMessageBoundary(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CuratorMessageBoundary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMessageBoundary() {
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /bỏ\s+qua\s+(mọi\s+|tất\s+cả\s+)?(chỉ\s+dẫn|hướng\s+dẫn|yêu\s+cầu)\s+(trước|ở\s+trên)/i,
    /quên\s+(mọi\s+|tất\s+cả\s+)?(chỉ\s+dẫn|hướng\s+dẫn)\s+(trước|ở\s+trên)/i,
    /system\s*prompt|developer\s*message|jailbreak|prompt\s*injection/i,
    /reveal|leak|show|print|repeat.{0,24}(api\s*key|secret|token|system\s*prompt)/i,
    /tiết\s*lộ|in\s+ra|hiển\s+thị.{0,24}(api\s*key|khóa\s*bí\s*mật|token|system\s*prompt)/i,
    /you\s+are\s+now|act\s+as\s+(an?\s+)?unrestricted/i
  ];

  const TECH_PATTERNS = [
    /\b(api|ai|backend|frontend|server|client|database|sql|docker|container|kubernetes|cvat|python|javascript|typescript|node(?:\.js)?|npm|git|github|cuda|gpu|pytorch|tensorflow|ollama|qwen|model|websocket|http|json|css|html|zoom|vlearn|deploy|debug|code|port)\b/i,
    /\b(lập\s*trình|mã\s*nguồn|thuật\s*toán|dữ\s*liệu|annotation|gán\s*nhãn|mô\s*hình|học\s*máy|trí\s*tuệ\s*nhân\s*tạo|cài\s*đặt|cấu\s*hình|kết\s*nối)\b/i
  ];
  const ADMIN_PATTERNS = [
    /\b(workshop|buổi\s*học|bài\s*tập|bài\s*lab|lab|deadline|hạn\s+nộp|nộp\s+bài|điểm\s*danh|chấm\s*điểm|lịch\s*học|link\s+(zoom|học|bài)|mã\s*qr|qr|team|nhóm|giảng\s*viên|trợ\s*giảng)\b/i
  ];
  const CLASS_TIME_PATTERN = /(?:^|\s)(?:hom nay|sang nay|chieu nay|toi nay|nay|ngay mai|sang mai|chieu mai|toi mai|mai|ngay kia|buoi nay|buoi hoc nay|buoi sau|buoi toi|buoi ke tiep|bua nay|bua sau|bua toi|tiet nay|tiet sau|tiet toi|lan toi|tuan sau|tuan toi|thu hai|thu ba|thu tu|thu nam|thu sau|thu bay|chu nhat|t[2-7])(?:\s|$)/i;
  const CLASS_TERM_PATTERN = /(?:^|\s)(?:hoc|day|giang|lop|bai|phan|chuong|mon|noi dung|chu de)(?:\s|$)/i;
  const CLASS_QUERY_PATTERN = /(?:^|\s)(?:gi|nao|the nao|o dau|phong nao|toi dau|den dau|online|offline|co hoc (?:khong|ko)|nghi hay|chuan bi)(?:\s|[?.!,]|$)/i;
  const CLASS_SEQUENCE_PATTERN = /(?:dang|tiep theo|ke tiep|sau (?:phan|bai) nay).{0,35}(?:hoc|day|giang|bai|phan|chuong|mon)|(?:hoc|day|giang).{0,25}(?:toi dau|den dau)/i;
  const CLASS_CONTINUATION_PATTERN = /(?:(?:van\s+)?(?:hoc|day|giang)\s+(?:tiep(?:\s+tuc)?\s+)?|(?:co\s+)?tiep\s+tuc\s+(?:hoc|day|giang)\s+)(?:phan|bai|chuong|noi\s+dung)\s+(?:nay|do|kia)\s+(?:khong|chu|a|ha)(?=\s|[?.!,]|$)/i;
  const CLASS_SCHEDULE_PATTERN = /(?:^|\s)(?:lich|co hoc|nghi|chuan bi)(?:\s|$)/i;
  const CLASS_AMBIGUOUS_PATTERN = /(?:cai (?:do|gi do)|phan (?:kia|do)|bai (?:kia|do)|dung (?:khong|ko)|ha)(?:\s|[?.!,]|$)/i;
  const FOLDED_OFF_TOPIC_PATTERN = /(?:an (?:com|mon|gi)|di choi|xem phim|phim gi|choi game|game gi|da bong|bong da|thoi tiet|xo so|ca si|mac ao|ngu qua)/i;
  const ERROR_PATTERNS = [
    /\b(error|exception|traceback|failed|failure|cannot|can't|timeout|crash|econnrefused|out\s+of\s+memory|already\s+in\s+use|permission\s+denied|not\s+found|undefined|nullpointer)\b/i,
    /\b(bị\s+lỗi|báo\s+lỗi|không\s+chạy|không\s+vào|không\s+kết\s+nối|không\s+cài|không\s+build|không\s+deploy|bị\s+kẹt|bị\s+treo|xung\s+đột\s+cổng)\b/i,
    /\b(line|at)\s+\d+\b|\b[A-Z][A-Za-z]+Error\b/
  ];
  const QUESTION_PATTERNS = [
    /\?$/,
    /\b(làm\s+sao|tại\s+sao|vì\s+sao|thế\s+nào|như\s+thế\s+nào|khi\s+nào|bao\s+giờ|ở\s+đâu|là\s+gì|được\s+không|có\s+.+\s+không|sửa\s+sao|xử\s+lý\s+sao)\b/i,
    /\b(how|why|what|when|where|can\s+i|could\s+you)\b/i
  ];
  const HELP_PATTERNS = [
    /\b(cho\s+em\s+hỏi|nhờ\s+(thầy|cô|anh|chị)|giúp\s+em|hướng\s+dẫn|chỉ\s+em|khắc\s+phục|cách\s+sửa|cách\s+làm)\b/i
  ];
  const OFF_TOPIC_PATTERNS = [
    /\b(ăn\s+cơm|đi\s+vệ\s+sinh|thời\s+tiết|trời\s+(đẹp|mưa|nắng)|bóng\s+đá|phim\s+gì|chơi\s+game|buồn\s+ngủ|đói\s+(bụng|quá)|bao\s+nhiêu\s+tuổi|quê\s+ở\s+đâu|người\s+yêu|xổ\s+số|ca\s+sĩ)\b/i
  ];

  function now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/@[\p{L}\p{N}_.-]+/gu, ' ')
      .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
      .replace(/^[\s,.:;!?-]*(?:(?:dạ|ạ|vâng|ừm|ờ|thưa)\s+)*(?:(?:chào|hello|hi|xin\s+chào)\s+)?(?:(?:thầy|cô|anh|chị|mọi\s+người)(?:\s+ơi)?[\s,.:;!?-]*)*/iu, '')
      .replace(/([!?.,])\1+/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function foldVietnameseText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/gi, (character) => character === 'Đ' ? 'D' : 'd')
      .toLowerCase()
      .replace(/\b(?:khong|ko|k)\b/g, 'khong')
      .replace(/[^a-z0-9?.!,]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasAny(text, patterns) {
    return patterns.some((pattern) => pattern.test(text));
  }

  function result(startedAt, decision, reasonCode, normalizedText, signals, score) {
    return {
      decision,
      reasonCode,
      normalizedText,
      signals,
      score,
      latencyMs: Math.max(0, now() - startedAt)
    };
  }

  function evaluateMessageBoundary(text) {
    const startedAt = now();
    const original = String(text || '').normalize('NFKC').trim();
    const normalizedText = normalizeText(original);
    const foldedText = foldVietnameseText(normalizedText);
    const signals = [];

    if (hasAny(original, INJECTION_PATTERNS)) {
      signals.push('prompt_injection');
      return result(startedAt, 'block', 'prompt_injection', normalizedText, signals, 1);
    }

    const technical = hasAny(normalizedText, TECH_PATTERNS);
    const administrative = hasAny(normalizedText, ADMIN_PATTERNS);
    const errorLog = hasAny(original, ERROR_PATTERNS);
    const question = hasAny(normalizedText, QUESTION_PATTERNS);
    const help = hasAny(normalizedText, HELP_PATTERNS);
    const explicitOffTopic = hasAny(normalizedText, OFF_TOPIC_PATTERNS) || FOLDED_OFF_TOPIC_PATTERN.test(foldedText);
    const hasClassTime = CLASS_TIME_PATTERN.test(foldedText);
    const hasClassTerm = CLASS_TERM_PATTERN.test(foldedText);
    const hasClassQuery = CLASS_QUERY_PATTERN.test(foldedText);
    const hasClassSequence = CLASS_SEQUENCE_PATTERN.test(foldedText);
    const hasClassContinuation = CLASS_CONTINUATION_PATTERN.test(foldedText);
    const hasClassSchedule = CLASS_SCHEDULE_PATTERN.test(foldedText);
    const classAmbiguous = !explicitOffTopic && hasClassTime && hasClassTerm && CLASS_AMBIGUOUS_PATTERN.test(foldedText);
    const classContext = !explicitOffTopic && !classAmbiguous && (
      (hasClassTime && ((hasClassTerm && hasClassQuery) || (hasClassSchedule && (hasClassQuery || question))))
      || (hasClassTime && hasClassContinuation)
      || (hasClassSequence && hasClassQuery)
      || (/\b(?:noi dung|chu de|chuong trinh)\b/.test(foldedText) && hasClassTime && hasClassQuery)
    );
    if (technical) signals.push('technical_term');
    if (administrative) signals.push('workshop_admin');
    if (classContext) signals.push('class_context');
    if (errorLog) signals.push('error_log');
    if (question) signals.push('question_word');
    if (help) signals.push('help_request');

    if (errorLog || classContext || administrative || (technical && (question || help || normalizedText.length >= 18))) {
      return result(
        startedAt,
        'allow',
        errorLog ? 'technical_error' : classContext ? 'class_agenda' : administrative ? 'workshop_admin' : 'technical_question',
        normalizedText,
        signals,
        errorLog ? 0.98 : classContext ? 0.96 : 0.94
      );
    }

    const greetingOnly = /^(?:(?:xin\s+)?chào|hello|hi|hey|alo)(?:\s+(?:thầy|cô|anh|chị|mọi\s+người))?(?:\s+(?:ạ|nhé))?[.!?]*$/iu.test(original);
    const courtesyOnly = /^(?:dạ\s+vâng|dạ|vâng|ok(?:ay)?|ừ|ừm|cảm\s+ơn(?:\s+(?:thầy|cô|anh|chị))?|thanks?|thank\s+you|em\s+hiểu\s+rồi|rõ\s+rồi|hay\s+quá|tuyệt(?:\s+vời)?|đã\s+rõ)(?:\s+ạ)?[.!?]*$/iu.test(original);
    const reactionOnly = /^(?:haha+|hehe+|hihi+|lol|wow|👏|👍|❤️|❤|🔥)+[.!?]*$/iu.test(original);
    if (greetingOnly || courtesyOnly || reactionOnly || !normalizedText) {
      signals.push(greetingOnly ? 'pure_greeting' : courtesyOnly ? 'courtesy' : 'reaction');
      return result(startedAt, 'filter', greetingOnly ? 'pure_greeting' : courtesyOnly ? 'courtesy' : 'reaction', normalizedText, signals, 0.99);
    }

    const vague = /^(?:cái|phần|đoạn|bước|chỗ|nó)?\s*(?:này|kia)?\s*(?:là\s+)?(?:sao|sao\s+vậy|sao\s+thế|không\s+hiểu|chưa\s+hiểu|không\s+được|giúp\s+em\s+với|xem\s+giúp\s+em)(?:\s+ạ)?[.!?]*$/iu.test(normalizedText);
    if (classAmbiguous) {
      signals.push('class_context', 'missing_context');
      return result(startedAt, 'review', 'class_context_ambiguous', normalizedText, signals, 0.68);
    }
    if (!vague && (explicitOffTopic || (question && !technical && !administrative && !help))) {
      signals.push('off_topic');
      return result(startedAt, 'filter', 'off_topic', normalizedText, signals, 0.93);
    }

    const tooShort = normalizedText.replace(/[^\p{L}\p{N}]/gu, '').length < 12;
    if (vague || tooShort || help || question) {
      signals.push(vague ? 'missing_context' : tooShort ? 'too_short' : 'ambiguous_request');
      return result(startedAt, 'review', vague ? 'missing_context' : tooShort ? 'too_short' : 'ambiguous', normalizedText, signals, 0.62);
    }

    signals.push('out_of_scope');
    return result(startedAt, 'filter', 'off_topic', normalizedText, signals, 0.86);
  }

  return { evaluateMessageBoundary, normalizeText, foldVietnameseText };
});
