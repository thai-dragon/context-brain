-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- Enable pgvector extension for semantic search
create extension if not exists vector;

-- Wiki pages: stores all long-term memory
create table if not exists wiki_pages (
  path        text primary key,
  title       text not null default '',
  content     text not null default '',
  tags        text[] not null default '{}',
  embedding   vector(1536),
  updated_at  timestamptz not null default now()
);

-- Hot context: short-term session memory
create table if not exists hot_context (
  id          text primary key default 'default',
  content     text not null default '',
  updated_at  timestamptz not null default now()
);

-- Semantic search function using cosine similarity
create or replace function search_wiki(
  query_embedding vector(1536),
  match_count     int default 5
)
returns table (path text, content text, similarity float)
language sql stable
as $$
  select
    path,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from wiki_pages
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Index for fast vector search
create index if not exists wiki_pages_embedding_idx
  on wiki_pages
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Daily planner: task tracking with points
create table if not exists daily_tasks (
  id          serial primary key,
  date        date not null,
  project     text not null,
  task        text not null,
  done        boolean not null default false,
  points      int not null default 1,
  created_at  timestamptz not null default now()
);

create index if not exists daily_tasks_date_idx on daily_tasks (date);
