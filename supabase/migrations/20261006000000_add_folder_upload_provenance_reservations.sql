-- Phase 7D.3a: additive provenance and durable reservation schema only.
-- Legacy documents and upload attempts intentionally retain NULL provenance.
alter table public.documents
  add column destination_folder_id uuid,
  add column source_relative_path text;

alter table public.documents
  add constraint documents_destination_folder_id_fkey
    foreign key (destination_folder_id) references public.document_folders(id) on delete restrict,
  add constraint documents_folder_upload_provenance_pair_chk check (
    (destination_folder_id is null and source_relative_path is null)
    or (
      destination_folder_id is not null
      and source_relative_path is not null
      and source_relative_path <> ''
      and octet_length(source_relative_path) <= 1024
    )
  );

alter table public.upload_attempts
  add column destination_folder_id uuid,
  add column source_relative_path text,
  add column normalized_relative_path_key text,
  add column content_sha256 bytea;

alter table public.upload_attempts
  add constraint upload_attempts_destination_folder_id_fkey
    foreign key (destination_folder_id) references public.document_folders(id) on delete restrict,
  add constraint upload_attempts_folder_upload_provenance_shape_chk check (
    (
      destination_folder_id is null
      and source_relative_path is null
      and normalized_relative_path_key is null
      and content_sha256 is null
    )
    or (
      destination_folder_id is not null
      and source_relative_path is not null
      and normalized_relative_path_key is not null
      and content_sha256 is not null
      and source_relative_path <> ''
      and normalized_relative_path_key <> ''
      and octet_length(source_relative_path) <= 1024
      and octet_length(normalized_relative_path_key) <= 1024
      and octet_length(content_sha256) = 32
    )
  );

-- A reservation is durable across every existing upload-attempt state.
create unique index upload_attempts_folder_destination_path_unique_idx
  on public.upload_attempts (destination_folder_id, normalized_relative_path_key)
  where destination_folder_id is not null
    and normalized_relative_path_key is not null;
