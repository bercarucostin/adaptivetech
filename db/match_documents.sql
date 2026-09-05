#variable_conflict use_column
begin
  return query
  select
    id,
    content,
    jsonb_build_object('title', metadata->>'original_file_name') as metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from documents
  where metadata @> filter
  order by documents.embedding <=> query_embedding
  limit match_count;
end;