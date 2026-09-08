export interface Project {
    id: string;
    name: string;
    repository: string;
    branch: string;
    context: string;
    dockerfile: string;
    containerPort: number;
    healthPath: string;
    autoDeploy: boolean;
    autoPromote: boolean;
    createdAt: string;
}

export interface Deployment {
    id: string;
    projectId: string;
    commit: string;
    state: 'queued' | 'building' | 'starting' | 'ready' | 'unavailable' | 'failed' | 'stopped';
    instanceName: string;
    imageId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
    configuration: Project;
}

export interface Route {
    id: string;
    hostname: string;
    path: string;
    target: string;
    previousTarget: string | null;
    stripPrefix: boolean;
    version: number;
    updatedAt: string;
}

export interface ManagedInstance {
    name: string;
    port: number;
    state: string;
    kind?: string;
    snapshot(): { name: string; port: number; state: string; pid?: number; kind?: string; deploymentId?: string };
    check(): Promise<boolean>;
    stop(): Promise<void>;
}
